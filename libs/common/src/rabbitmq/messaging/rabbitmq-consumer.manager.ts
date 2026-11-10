import { Logger } from '@nestjs/common';
import type { Channel, ConsumeMessage } from 'amqplib';
import { randomUUID } from 'node:crypto';
import { within, positive } from '../common/helper/async.helper.ts';
import { RabbitMQError } from '../common/error/rabbitmq.error.ts';
import type {
  ConsumerOptions,
  MessageContext,
  RabbitMQOptions,
  TraceAdapter,
} from '../common/interface/index.ts';
import type { MessageHandler } from '../common/type/index.ts';
import type { Consumer } from '../common/interface/consumer.interface.ts';
import type { Session } from '../common/interface/session.interface.ts';
import type { RabbitMQConnectionManager } from '../connection/rabbitmq-connection.manager.ts';

export class RabbitMQConsumerManager {
  private readonly logger = new Logger(RabbitMQConsumerManager.name);
  private readonly consumers = new Map<string, Consumer>();
  constructor(
    private readonly options: RabbitMQOptions,
    private readonly trace: TraceAdapter,
    private readonly connection: RabbitMQConnectionManager,
  ) {
    connection.observe({
      ready: async (session) => {
        for (const consumer of this.consumers.values())
          if (!consumer.stopped) await this.startConsumer(consumer, session);
      },
      lost: () => {
        for (const consumer of this.consumers.values()) {
          consumer.channel = undefined;
          consumer.tag = undefined;
        }
      },
    });
  }
  async close(): Promise<void> {
    await within(
      Promise.allSettled(
        [...this.consumers.keys()].map((id) => this.stopConsumer(id)),
      ),
      this.options.shutdownTimeoutMs ?? 10000,
    );
  }
  async consume<T>(
    queue: string,
    handler: MessageHandler<T>,
    options: ConsumerOptions = {},
  ): Promise<string> {
    this.connection.assertOpen();
    positive(options.prefetch ?? this.options.prefetch ?? 10, 'prefetch');
    positive(
      options.requeueDelayMs ?? this.options.requeueDelayMs ?? 5000,
      'requeueDelayMs',
    );
    const id = options.id ?? randomUUID();
    if (this.consumers.has(id))
      throw new RabbitMQError(
        'DUPLICATE_CONSUMER',
        `Consumer ${id} already exists`,
      );
    const consumer: Consumer = {
      id,
      queue,
      handler: handler as MessageHandler,
      options,
      stopped: false,
      tasks: new Set(),
    };
    this.consumers.set(id, consumer);
    try {
      const session = await this.connection.connected();
      if (!consumer.channel && !consumer.stopped)
        await this.startConsumer(consumer, session);
      return id;
    } catch (error) {
      this.consumers.delete(id);
      throw error;
    }
  }
  private async startConsumer(
    consumer: Consumer,
    session: Session,
  ): Promise<void> {
    const channel = await this.connection.channels.create(
      session,
      () => !consumer.stopped,
    );
    if (consumer.stopped || this.connection.isClosing || session.closed) {
      await channel.close().catch(() => undefined);
      return;
    }
    consumer.channel = channel;
    try {
      await within(channel.checkQueue(consumer.queue), this.connection.timeout);
      await within(
        channel.prefetch(
          consumer.options.prefetch ?? this.options.prefetch ?? 10,
        ),
        this.connection.timeout,
      );
      const result = await within(
        channel.consume(
          consumer.queue,
          (message) => {
            if (!message) {
              if (!consumer.stopped) this.connection.invalidate(session);
              return;
            }
            if (consumer.stopped || this.connection.isClosing) {
              channel.nack(message, false, true);
              return;
            }
            const task = this.deliver(consumer, session, channel, message);
            consumer.tasks.add(task);
            void task.finally(() => consumer.tasks.delete(task));
          },
          { noAck: false },
        ),
        this.connection.timeout,
      );
      consumer.tag = result.consumerTag;
      if (consumer.stopped || this.connection.isClosing) {
        await channel.cancel(result.consumerTag);
        await channel.close();
      }
    } catch (error) {
      this.connection.invalidate(session);
      throw error;
    }
  }
  private async deliver(
    consumer: Consumer,
    session: Session,
    channel: Channel,
    message: ConsumeMessage,
  ): Promise<void> {
    try {
      if (!message.properties.messageId)
        throw new RabbitMQError(
          'MISSING_MESSAGE_ID',
          'Incoming messages must have a stable messageId for Inbox deduplication',
        );
      const context: MessageContext = {
        messageId: message.properties.messageId,
        headers: message.properties.headers ?? {},
        correlationId: message.properties.correlationId,
        replyTo: message.properties.replyTo,
        redelivered: message.fields.redelivered,
      };
      const data: unknown = JSON.parse(message.content.toString('utf8'));
      await this.trace.run(
        `rabbitmq ${consumer.queue}`,
        context.headers,
        async () => consumer.handler(data, context),
      );
      if (!session.closed) channel.ack(message);
    } catch (error) {
      this.logger.warn(
        `Consumer ${consumer.id} failed; delivery remains unacknowledged until delayed requeue (${error instanceof RabbitMQError ? error.code : 'HANDLER_ERROR'})`,
      );
      // Inbox persistence failures must not lose messages or create a hot requeue loop.
      if (!session.closed) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(
            done,
            consumer.options.requeueDelayMs ??
              this.options.requeueDelayMs ??
              5000,
          );
          function done() {
            clearTimeout(timer);
            channel.off('close', done);
            resolve();
          }
          channel.once('close', done);
        });
        if (!session.closed) {
          try {
            channel.nack(message, false, true);
          } catch {
            this.connection.invalidate(session);
          }
        }
      }
    }
  }
  async stopConsumer(id: string): Promise<void> {
    const consumer = this.consumers.get(id);
    if (!consumer) return;
    consumer.stopped = true;
    this.consumers.delete(id);
    try {
      if (consumer.channel && consumer.tag)
        await within(
          consumer.channel.cancel(consumer.tag),
          this.connection.timeout,
        );
      await within(
        Promise.allSettled(consumer.tasks),
        this.options.shutdownTimeoutMs ?? 10000,
      );
    } finally {
      await consumer.channel?.close().catch(() => undefined);
    }
  }
}
