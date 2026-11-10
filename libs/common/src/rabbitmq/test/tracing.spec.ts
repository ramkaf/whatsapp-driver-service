import { describe, expect, it } from 'vitest';
import { ElasticTraceAdapter } from '../tracing/elastic-trace.adapter.ts';

describe('Trace propagation', () => {
  it('preserves a supplied context and arbitrary headers', () => {
    const trace = new ElasticTraceAdapter();
    const parent = '00-12345678901234567890123456789012-1234567890123456-01';
    expect(
      trace.inject({
        traceparent: parent,
        tracestate: 'vendor=value',
        baggage: 'a=b',
        custom: 5,
      }),
    ).toEqual({
      traceparent: parent,
      tracestate: 'vendor=value',
      baggage: 'a=b',
      custom: 5,
      'trace.id': parent.slice(3, 35),
    });
  });
  it('creates a valid context without APM and isolates concurrent consumers', async () => {
    const trace = new ElasticTraceAdapter();
    const first = trace.inject();
    const second = trace.inject();
    expect(first.traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-00$/);
    expect(first['trace.id']).not.toBe(second['trace.id']);
    const results = await Promise.all(
      [first, second].map((headers) =>
        trace.run('test', headers, async () => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return trace.inject()['trace.id'];
        }),
      ),
    );
    expect(results).toEqual([first['trace.id'], second['trace.id']]);
  });
});
