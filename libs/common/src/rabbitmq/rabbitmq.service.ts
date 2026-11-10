import { Logger } from '@nestjs/common';
import type {
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { connect } from 'amqplib';
import { positive } from './common/helper/async.helper.ts';
import { RabbitMQError } from './common/error/rabbitmq.error.ts';
import type {
  ConsumerOptions,
  PublishOptions,
  RabbitMQOptions,
  RpcDestination,
} from './common/interface/index.ts';
import type { MessageHandler } from './common/type/index.ts';
import { ElasticTraceAdapter } from './tracing/elastic-trace.adapter.ts';
import { RabbitMQConnectionManager } from './connection/rabbitmq-connection.manager.ts';
import { RabbitMQPublisher } from './messaging/rabbitmq.publisher.ts';
import { RabbitMQConsumerManager } from './messaging/rabbitmq-consumer.manager.ts';
import { RabbitMQRpcManager } from './rpc/rabbitmq-rpc.manager.ts';

/** Public API and Nest lifecycle; each manager owns its own protocol state. */
export class RabbitMQService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(RabbitMQService.name);
  private readonly connection: RabbitMQConnectionManager;
  private readonly publisher: RabbitMQPublisher;
  private readonly consumers: RabbitMQConsumerManager;
  private readonly rpc: RabbitMQRpcManager;
  private closePromise?: Promise<void>;

  constructor(options: RabbitMQOptions, connector: typeof connect = connect) {
    if (
      typeof options.topologyPath !== 'string' ||
      !options.topologyPath.trim()
    ) {
      throw new RabbitMQError(
        'INVALID_CONFIG',
        'topologyPath must point to the shared JSON file',
      );
    }
    for (const [name, value] of Object.entries({
      connectTimeoutMs: options.connectTimeoutMs,
      operationTimeoutMs: options.operationTimeoutMs,
      prefetch: options.prefetch,
      requeueDelayMs: options.requeueDelayMs,
      shutdownTimeoutMs: options.shutdownTimeoutMs,
      maxPendingPublishes: options.maxPendingPublishes,
      maxPendingRequests: options.maxPendingRequests,
      rpcTimeoutMs: options.rpcTimeoutMs,
      initialDelayMs: options.reconnect?.initialDelayMs,
      maxDelayMs: options.reconnect?.maxDelayMs,
    }))
      if (value !== undefined) positive(value, name);

    const trace = options.trace ?? new ElasticTraceAdapter();
    this.connection = new RabbitMQConnectionManager(options, connector);
    this.publisher = new RabbitMQPublisher(options, trace, this.connection);
    this.consumers = new RabbitMQConsumerManager(
      options,
      trace,
      this.connection,
    );
    this.rpc = new RabbitMQRpcManager(
      options,
      trace,
      this.connection,
      this.publisher,
      this.consumers,
    );
  }
  async onApplicationBootstrap(): Promise<void> {
    await this.initialize();
  }
  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }
  async initialize(): Promise<void> {
    await this.connection.connected();
  }
  async send(
    queue: string,
    data: unknown,
    options: PublishOptions = {},
  ): Promise<void> {
    await this.publisher.publish('', queue, data, options);
  }
  async publish(
    exchange: string,
    routingKey: string,
    data: unknown,
    options: PublishOptions = {},
  ): Promise<void> {
    await this.publisher.publish(exchange, routingKey, data, options);
  }
  async consume<T>(
    queue: string,
    handler: MessageHandler<T>,
    options: ConsumerOptions = {},
  ): Promise<string> {
    return this.consumers.consume(queue, handler, options);
  }
  async stopConsumer(id: string): Promise<void> {
    await this.consumers.stopConsumer(id);
  }
  async request<T = unknown>(
    destination: string | RpcDestination,
    data: unknown,
    options: PublishOptions = {},
  ): Promise<T> {
    return this.rpc.request<T>(destination, data, options);
  }
  async handleRequest<T, R = unknown>(
    queue: string,
    handler: MessageHandler<T, R>,
    options: ConsumerOptions = {},
  ): Promise<string> {
    return this.rpc.handleRequest(queue, handler, options);
  }
  close(): Promise<void> {
    this.closePromise ??= this.shutdown();
    return this.closePromise;
  }
  private async shutdown(): Promise<void> {
    this.connection.beginShutdown();
    try {
      await this.consumers.close();
      await this.publisher.flush();
    } catch {
      this.logger.warn(
        'Shutdown grace period elapsed; unfinished deliveries will be requeued',
      );
    } finally {
      this.rpc.close();
      await this.connection.close();
    }
  }
}
