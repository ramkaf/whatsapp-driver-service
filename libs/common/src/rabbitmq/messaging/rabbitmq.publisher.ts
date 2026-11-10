import { randomUUID } from 'node:crypto';
import { within, positive } from '../common/helper/async.helper.ts';
import { RabbitMQError } from '../common/error/rabbitmq.error.ts';
import type {
  PublishOptions,
  RabbitMQOptions,
  TraceAdapter,
} from '../common/interface/index.ts';
import type { PendingPublish } from '../common/interface/pending-publish.interface.ts';
import type { RabbitMQConnectionManager } from '../connection/rabbitmq-connection.manager.ts';

export class RabbitMQPublisher {
  private readonly publishes = new Map<string, PendingPublish>();
  private publishCount = 0;
  constructor(
    private readonly options: RabbitMQOptions,
    private readonly trace: TraceAdapter,
    private readonly connection: RabbitMQConnectionManager,
  ) {
    connection.observe({
      ready: (session) => {
        session.publisher.on('return', (message) => {
          const id = message.properties.headers?.['x-module-publication-id'];
          if (typeof id === 'string')
            this.publishes
              .get(id)
              ?.finish(
                new RabbitMQError(
                  'UNROUTABLE',
                  'Message did not reach any queue',
                ),
              );
        });
      },
      lost: (error) => {
        for (const pending of this.publishes.values()) pending.finish(error);
      },
    });
  }
  async flush(): Promise<void> {
    const session = this.connection.current;
    if (session)
      await within(
        session.publisher.waitForConfirms(),
        this.options.shutdownTimeoutMs ?? 10000,
      );
  }
  async publish(
    exchange: string,
    routingKey: string,
    data: unknown,
    options: PublishOptions = {},
    allowClosing = false,
  ): Promise<void> {
    if (!allowClosing) this.connection.assertOpen();
    if (this.publishCount >= (this.options.maxPendingPublishes ?? 1000))
      throw new RabbitMQError('PUBLISH_LIMIT', 'Too many pending publications');
    const body = JSON.stringify(data);
    if (body === undefined)
      throw new RabbitMQError(
        'INVALID_MESSAGE',
        'Message must be JSON serializable',
      );
    const timeout = positive(
      options.timeoutMs ?? this.connection.timeout,
      'timeoutMs',
    );
    const deadline = Date.now() + timeout;
    // Capture context before asynchronous connection and flow-control waits.
    const headers = this.trace.inject(options.headers);
    this.publishCount++;
    try {
      const session = await within(
        allowClosing && this.connection.current
          ? Promise.resolve(this.connection.current)
          : this.connection.connected(),
        deadline - Date.now(),
      );
      while (session.drain) await within(session.drain, deadline - Date.now());
      if (!allowClosing) this.connection.assertOpen();
      if (session.closed)
        throw new RabbitMQError(
          'CONNECTION_LOST',
          'Connection closed before publication',
        );
      if (session.blocked)
        throw new RabbitMQError(
          'BROKER_BLOCKED',
          'Broker temporarily blocked publication',
        );
      if (Date.now() >= deadline)
        throw new RabbitMQError(
          'OPERATION_TIMEOUT',
          'Publication deadline elapsed',
        );
      await new Promise<void>((resolve, reject) => {
        const publicationId = randomUUID();
        let settled = false;
        const timer = setTimeout(
          () =>
            finish(
              new RabbitMQError(
                'CONFIRM_TIMEOUT',
                'Confirmation timed out; publication outcome is unknown',
              ),
            ),
          deadline - Date.now(),
        );
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.publishes.delete(publicationId);
          if (error) reject(error);
          else resolve();
        };
        this.publishes.set(publicationId, { finish });
        try {
          const writable = session.publisher.publish(
            exchange,
            routingKey,
            Buffer.from(body),
            {
              ...options,
              messageId: options.messageId ?? randomUUID(),
              persistent: options.persistent ?? true,
              mandatory: options.mandatory ?? true,
              contentType: 'application/json',
              timestamp: Math.floor(Date.now() / 1000),
              headers: { ...headers, 'x-module-publication-id': publicationId },
            },
            (error) =>
              finish(
                error
                  ? new RabbitMQError(
                      'PUBLISH_NACK',
                      'Broker rejected publication',
                      { cause: error },
                    )
                  : undefined,
              ),
          );
          if (!writable && !session.drain)
            session.drain = new Promise((resolveDrain) => {
              session.releaseDrain = resolveDrain;
            });
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
    } finally {
      this.publishCount--;
    }
  }
}
