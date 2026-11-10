import { Logger } from '@nestjs/common';
import { connect } from 'amqplib';
import type { ChannelModel } from 'amqplib';
import { within } from '../common/helper/async.helper.ts';
import { RabbitMQError } from '../common/error/rabbitmq.error.ts';
import type { RabbitMQOptions, Topology } from '../common/interface/index.ts';
import type { Session } from '../common/interface/session.interface.ts';
import type { ConnectionObserver } from '../common/interface/connection-observer.interface.ts';
import { RabbitMQChannelManager } from '../channel/rabbitmq-channel.manager.ts';
import { readTopology } from '../topology/topology.loader.ts';

export class RabbitMQConnectionManager {
  private readonly logger = new Logger(RabbitMQConnectionManager.name);
  private session?: Session;
  private connecting?: Promise<Session>;
  private topology?: Promise<Required<Topology>>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  private closing = false;
  private readonly observers: ConnectionObserver[] = [];
  readonly channels: RabbitMQChannelManager;

  constructor(
    private readonly options: RabbitMQOptions,
    private readonly connector: typeof connect = connect,
  ) {
    this.channels = new RabbitMQChannelManager(this.timeout, (session) =>
      this.invalidate(session),
    );
  }
  get current(): Session | undefined {
    return this.session;
  }
  get isClosing(): boolean {
    return this.closing;
  }
  get timeout(): number {
    return this.options.operationTimeoutMs ?? 10000;
  }
  observe(observer: ConnectionObserver): void {
    this.observers.push(observer);
  }
  assertOpen(): void {
    if (this.closing)
      throw new RabbitMQError('CLOSED', 'RabbitMQ module is shutting down');
  }
  beginShutdown(): void {
    this.closing = true;
    clearTimeout(this.reconnectTimer);
  }
  async close(): Promise<void> {
    this.beginShutdown();
    const session = this.session;
    if (!session) return;
    this.invalidate(session);
    await within(
      session.connection.close().catch(() => undefined),
      this.options.shutdownTimeoutMs ?? 10000,
    ).catch(() => undefined);
  }
  private readyTopology(): Promise<Required<Topology>> {
    this.topology ??= readTopology(this.options.topologyPath).catch((error) => {
      this.topology = undefined;
      throw error;
    });
    return this.topology;
  }
  private async reconcile(session: Session): Promise<void> {
    const topology = await this.readyTopology();
    try {
      await within(
        (async () => {
          for (const { name, type, ...settings } of topology.exchanges)
            await session.control.assertExchange(name, type, settings);
          for (const { name, ...settings } of topology.queues)
            await session.control.assertQueue(name, {
              ...settings,
              exclusive: false,
            });
          for (const b of topology.bindings)
            await session.control.bindQueue(
              b.queue,
              b.exchange,
              b.routingKey,
              b.arguments,
            );
        })(),
        this.timeout,
      );
    } catch (error) {
      this.invalidate(session);
      throw error;
    }
  }
  async connected(): Promise<Session> {
    this.assertOpen();
    if (this.connecting) return this.connecting;
    if (this.session && !this.session.closed) return this.session;
    this.connecting = this.readyTopology()
      .then(() => this.openSession())
      .finally(() => {
        this.connecting = undefined;
      });
    return this.connecting;
  }
  private async openSession(): Promise<Session> {
    let connection: ChannelModel | undefined;
    let session: Session | undefined;
    try {
      this.assertOpen();
      const connectTimeout = this.options.connectTimeoutMs ?? 10000;
      const pending = this.connector(this.options.url, {
        timeout: connectTimeout,
        noDelay: true,
      });
      let expired = false;
      void pending.then(
        (c) => {
          if (expired || this.closing) void c.close().catch(() => undefined);
        },
        () => undefined,
      );
      try {
        connection = await within(pending, connectTimeout, 'CONNECT_TIMEOUT');
      } catch (error) {
        expired = true;
        throw error;
      }
      connection.on('error', () => {
        /* close drives recovery; never log credential-bearing URLs */
      });
      this.assertOpen();
      session = await this.channels.createSession(connection);
      this.assertOpen();
      const current = session;
      this.session = session;
      connection.on('close', () => this.invalidate(current));
      connection.on('blocked', () => {
        current.blocked = true;
      });
      connection.on('unblocked', () => {
        current.blocked = false;
      });
      await this.reconcile(session);
      for (const observer of this.observers) await observer.ready?.(session);
      this.reconnectAttempt = 0;
      return session;
    } catch (error) {
      if (session && this.session === session) this.invalidate(session);
      else if (connection) void connection.close().catch(() => undefined);
      this.scheduleReconnect();
      throw error;
    }
  }
  invalidate(session: Session): void {
    if (session.closed) return;
    session.closed = true;
    session.releaseDrain?.();
    if (this.session !== session) return;
    this.session = undefined;
    const error = new RabbitMQError(
      'CONNECTION_LOST',
      'Connection/channel lost; publication outcome may be unknown',
    );
    for (const observer of this.observers) observer.lost?.(error);
    void session.connection.close().catch(() => undefined);
    this.scheduleReconnect();
  }
  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimer) return;
    const base = this.options.reconnect?.initialDelayMs ?? 1000;
    const cap = this.options.reconnect?.maxDelayMs ?? 30000;
    const delay =
      Math.min(cap, base * 2 ** Math.min(this.reconnectAttempt++, 16)) *
      (0.5 + Math.random() * 0.5);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connected().catch(() => {
        this.logger.warn(
          'RabbitMQ recovery failed; another attempt is scheduled',
        );
        this.scheduleReconnect();
      });
    }, delay);
    this.reconnectTimer.unref();
  }
}
