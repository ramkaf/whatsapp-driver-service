import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bindingId,
  canonical,
  normalize,
} from '../topology/topology.validation.ts';
import { readTopology } from '../topology/topology.loader.ts';

describe('Topology identity', () => {
  it('does not create a different binding for reordered argument keys', () => {
    const binding = {
      queue: 'sms',
      exchange: 'users',
      routingKey: 'registered',
    };
    expect(bindingId({ ...binding, arguments: { a: 1, b: 2 } })).toBe(
      bindingId({ ...binding, arguments: { b: 2, a: 1 } }),
    );
    expect(bindingId(binding)).toBe(bindingId({ ...binding, arguments: {} }));
    expect(bindingId(binding)).not.toBe(
      bindingId({ ...binding, routingKey: 'updated' }),
    );
  });
  it('normalizes defaults so repeated identical declarations match', () => {
    expect(canonical(normalize({ queues: [{ name: 'sms' }] }))).toBe(
      canonical(
        normalize({
          queues: [
            { name: 'sms', durable: true, autoDelete: false, arguments: {} },
          ],
        }),
      ),
    );
  });
  it('deduplicates equivalent declarations and bindings', () => {
    const b = { queue: 'sms', exchange: 'users', routingKey: 'registered' };
    const result = normalize({
      exchanges: [
        { name: 'users', type: 'direct' },
        { name: 'users', type: 'direct', durable: true },
      ],
      queues: [{ name: 'sms' }, { name: 'sms', durable: true }],
      bindings: [b, { ...b, arguments: {} }],
    });
    expect(result.exchanges).toHaveLength(1);
    expect(result.queues).toHaveLength(1);
    expect(result.bindings).toHaveLength(1);
  });
  it('rejects conflicting names and missing binding references', () => {
    expect(() =>
      normalize({ queues: [{ name: 'sms' }, { name: 'sms', durable: false }] }),
    ).toThrow('Conflicting definitions');
    expect(() =>
      normalize({
        exchanges: [
          { name: 'users', type: 'direct' },
          { name: 'users', type: 'topic' },
        ],
      }),
    ).toThrow('Conflicting definitions');
    expect(() =>
      normalize({
        bindings: [{ queue: 'missing', exchange: 'missing', routingKey: '' }],
      }),
    ).toThrow('undeclared');
  });
  it.each([
    null,
    [],
    { queues: {} },
    { queues: [null] },
    { exchanges: [{ name: 'x', type: 'invalid' }] },
    { queues: [{ name: 'sms', durable: 'true' }] },
    { queues: [{ name: 'sms', arguments: [] }] },
    { queue: [] },
  ])('rejects malformed topology: %j', (input) => {
    expect(() => normalize(input)).toThrow();
  });
  it('reads and validates JSON without modifying the file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'topology-unit-'));
    const path = join(directory, 'topology.json');
    try {
      await writeFile(path, '{"queues":[{"name":"sms"}]}');
      expect((await readTopology(path)).queues[0]).toMatchObject({
        name: 'sms',
        durable: true,
      });
      await writeFile(path, '{broken');
      await expect(readTopology(path)).rejects.toMatchObject({
        code: 'INVALID_TOPOLOGY',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('rejects reserved, empty and oversized names', () => {
    for (const name of ['', 'amq.reserved', 'a'.repeat(256)])
      expect(() => normalize({ queues: [{ name }] })).toThrow();
  });
});
