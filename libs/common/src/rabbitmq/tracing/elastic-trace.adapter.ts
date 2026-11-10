import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import apm from 'elastic-apm-node';
import type { Headers } from '../common/type/index.ts';
import type { TraceAdapter } from '../common/interface/index.ts';

function validParent(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^00-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/.test(value) &&
    value.slice(3, 35) !== '0'.repeat(32) &&
    value.slice(36, 52) !== '0'.repeat(16)
  );
}
/** Reuses the agent started by the application's logger; never starts a second agent. */
export class ElasticTraceAdapter implements TraceAdapter {
  private readonly context = new AsyncLocalStorage<Headers>();
  captureError(error: unknown): void {
    if (!apm.isStarted()) return;
    if (apm.currentTransaction) apm.currentTransaction.outcome = 'failure';
    apm.captureError(error instanceof Error ? error : String(error));
  }
  inject(headers: Headers = {}): Headers {
    const inherited = this.context.getStore() ?? {};
    const current = apm.currentTraceparent;
    const explicit = headers.traceparent;
    const parent = validParent(explicit)
      ? explicit
      : validParent(current)
        ? current
        : validParent(inherited.traceparent)
          ? inherited.traceparent
          : `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-00`;
    // Preserve caller headers (including tracestate/baggage and custom APM metadata).
    return {
      ...inherited,
      ...headers,
      traceparent: parent,
      'trace.id': parent.slice(3, 35),
    };
  }
  async run<T>(
    name: string,
    headers: Headers,
    handler: () => Promise<T>,
  ): Promise<T> {
    const resource = new AsyncResource('rabbitmq-handler');
    try {
      return await resource.runInAsyncScope(() =>
        this.context.run(this.inject(headers), async () => {
          const context = this.context.getStore()!;
          const transaction = apm.isStarted()
            ? apm.startTransaction(name, 'messaging', {
                childOf: context.traceparent as string,
                tracestate:
                  typeof context.tracestate === 'string'
                    ? context.tracestate
                    : undefined,
              })
            : null;
          try {
            const result = await handler();
            if (transaction && transaction.outcome !== 'failure')
              transaction.outcome = 'success';
            return result;
          } catch (error) {
            if (transaction) {
              transaction.outcome = 'failure';
              apm.captureError(error instanceof Error ? error : String(error));
            }
            throw error;
          } finally {
            transaction?.end();
          }
        }),
      );
    } finally {
      resource.emitDestroy();
    }
  }
}
