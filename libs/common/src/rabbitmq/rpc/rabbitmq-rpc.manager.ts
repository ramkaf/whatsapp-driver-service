import { Logger } from '@nestjs/common';
import type { Channel } from 'amqplib';
import { randomUUID } from 'node:crypto';
import { within, positive } from '../common/helper/async.helper.ts';
import {
  RabbitMQError,
  RpcPublicError,
  RpcRemoteError,
} from '../common/error/rabbitmq.error.ts';
import type {
  ConsumerOptions,
  PublishOptions,
  RabbitMQOptions,
  RpcDestination,
  TraceAdapter,
} from '../common/interface/index.ts';
import type { MessageHandler } from '../common/type/index.ts';
import type { Session } from '../common/interface/session.interface.ts';
import type { PendingRequest } from '../common/interface/pending-request.interface.ts';
import type { RabbitMQConnectionManager } from '../connection/rabbitmq-connection.manager.ts';
import type { RabbitMQPublisher } from '../messaging/rabbitmq.publisher.ts';
import type { RabbitMQConsumerManager } from '../messaging/rabbitmq-consumer.manager.ts';

export class RabbitMQRpcManager {
  private readonly logger = new Logger(RabbitMQRpcManager.name);
  private readonly requests = new Map<string, PendingRequest>();
  private reply?: { session: Session; channel: Channel; queue: string };
  private replyCreating?: Promise<string>;
  constructor(
    private readonly options: RabbitMQOptions,
    private readonly trace: TraceAdapter,
    private readonly connection: RabbitMQConnectionManager,
    private readonly publisher: RabbitMQPublisher,
    private readonly consumers: RabbitMQConsumerManager,
  ) {
    connection.observe({ lost: (error) => this.clear(error) });
  }
  private clear(error: RabbitMQError): void {
    this.reply = undefined;
    for (const [id, pending] of this.requests) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.requests.delete(id);
    }
  }
  close(): void {
    this.clear(new RabbitMQError('CLOSED', 'Module closed'));
  }
  private async replyQueue(session: Session): Promise<string> {
    if (this.reply?.session === session) return this.reply.queue;
    if (this.replyCreating) return this.replyCreating;
    this.replyCreating = (async () => {
      const channel = await this.connection.channels.create(session);
      const queue = await within(
        channel.assertQueue('', {
          durable: false,
          exclusive: true,
          autoDelete: true,
        }),
        this.connection.timeout,
      );
      await within(
        channel.consume(
          queue.queue,
          (message) => {
            if (!message) {
              this.connection.invalidate(session);
              return;
            }
            const id = message.properties.correlationId;
            const pending = id ? this.requests.get(id) : undefined;
            if (!pending || !id) return; // noAck: replies are ephemeral, late/duplicate replies are ignored.
            this.requests.delete(id);
            clearTimeout(pending.timer);
            try {
              const body: unknown = JSON.parse(
                message.content.toString('utf8'),
              );
              if (
                !body ||
                typeof body !== 'object' ||
                !('ok' in body) ||
                typeof body.ok !== 'boolean'
              )
                throw new RabbitMQError(
                  'INVALID_RPC_RESPONSE',
                  'Invalid RPC response',
                );
              if (body.ok)
                pending.resolve('data' in body ? body.data : undefined);
              else
                pending.reject(
                  new RpcRemoteError(
                    'error' in body && typeof body.error === 'string'
                      ? body.error
                      : undefined,
                  ),
                );
            } catch (error) {
              pending.reject(error);
            }
          },
          { noAck: true },
        ),
        this.connection.timeout,
      );
      if (session.closed)
        throw new RabbitMQError(
          'CONNECTION_LOST',
          'Connection lost while creating RPC reply queue',
        );
      this.reply = { session, channel, queue: queue.queue };
      return queue.queue;
    })()
      .catch((error) => {
        this.connection.invalidate(session);
        throw error;
      })
      .finally(() => {
        this.replyCreating = undefined;
      });
    return this.replyCreating;
  }
  async request<T = unknown>(
    destination: string | RpcDestination,
    data: unknown,
    options: PublishOptions = {},
  ): Promise<T> {
    this.connection.assertOpen();
    if (this.requests.size >= (this.options.maxPendingRequests ?? 1000))
      throw new RabbitMQError('RPC_LIMIT', 'Too many pending RPC requests');
    const timeout = positive(
      options.timeoutMs ?? this.options.rpcTimeoutMs ?? 5000,
      'timeoutMs',
    );
    const correlationId = randomUUID();
    const deadline = Date.now() + timeout;
    const headers = this.trace.inject(options.headers);
    const response = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(correlationId);
        reject(
          new RabbitMQError(
            'RPC_TIMEOUT',
            'RPC timed out; remote work may still have executed',
          ),
        );
      }, timeout);
      this.requests.set(correlationId, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
    });
    // Attach a rejection observer immediately while connection setup is in progress.
    void response.catch(() => undefined);
    try {
      const session = await within(
        this.connection.connected(),
        deadline - Date.now(),
        'RPC_TIMEOUT',
      );
      const replyTo = await within(
        this.replyQueue(session),
        deadline - Date.now(),
        'RPC_TIMEOUT',
      );
      if (!this.requests.has(correlationId) || Date.now() >= deadline)
        throw new RabbitMQError(
          'RPC_TIMEOUT',
          'RPC deadline elapsed before publication',
        );
      await this.publisher.publish(
        typeof destination === 'string' ? '' : destination.exchange,
        typeof destination === 'string' ? destination : destination.routingKey,
        data,
        {
          ...options,
          headers,
          correlationId,
          replyTo,
          timeoutMs: Math.max(1, deadline - Date.now()),
          expiration: String(Math.max(1, deadline - Date.now())),
        },
      );
    } catch (error) {
      const pending = this.requests.get(correlationId);
      if (pending) {
        clearTimeout(pending.timer);
        this.requests.delete(correlationId);
        pending.reject(error);
      }
    }
    return response;
  }
  async handleRequest<T, R = unknown>(
    queue: string,
    handler: MessageHandler<T, R>,
    options: ConsumerOptions = {},
  ): Promise<string> {
    return this.consumers.consume<T>(
      queue,
      async (data, context) => {
        if (!context.replyTo || !context.correlationId)
          throw new RabbitMQError(
            'INVALID_RPC_REQUEST',
            'RPC request requires replyTo and correlationId',
          );
        let response: { ok: boolean; data?: R; error?: string };
        try {
          response = { ok: true, data: await handler(data, context) };
        } catch (error) {
          this.trace.captureError?.(error);
          this.logger.warn(`RPC handler ${queue} failed`);
          response = {
            ok: false,
            error:
              error instanceof RpcPublicError
                ? error.message
                : 'Remote handler failed',
          };
        }
        try {
          await this.publisher.publish(
            '',
            context.replyTo,
            response,
            { correlationId: context.correlationId },
            true,
          );
        } catch (error) {
          // The private reply queue may be gone after caller shutdown. Re-executing
          // business logic cannot repair it; confirm-return is a terminal response failure.
          if (!(error instanceof RabbitMQError && error.code === 'UNROUTABLE'))
            throw error;
          this.logger.warn('RPC caller reply queue no longer exists');
        }
      },
      options,
    );
  }
}
