import { createHash } from 'node:crypto';
import type {
  BindingDefinition,
  ExchangeDefinition,
  QueueDefinition,
  Topology,
} from '../common/interface/index.ts';
import type { Headers } from '../common/type/index.ts';
import { RabbitMQError } from '../common/error/rabbitmq.error.ts';

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value))
    invalid('Numbers must be finite');
  const result = JSON.stringify(value);
  if (result === undefined) invalid('Topology must be JSON serializable');
  return result;
}
function invalid(message: string): never {
  throw new RabbitMQError('INVALID_TOPOLOGY', message);
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) invalid(`Unknown topology field: ${key}`);
}
function entries(value: unknown, label: string): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalid(`${label} must be an array`);
  return value.map((entry) => object(entry, label));
}
function name(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    Buffer.byteLength(value) > 255 ||
    value.startsWith('amq.')
  ) {
    invalid(
      'Names must be nonempty, at most 255 bytes, and not start with amq.',
    );
  }
  return value;
}
function boolean(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') invalid(`${label} must be a boolean`);
  return value;
}
function args(value: unknown): Headers {
  return value === undefined ? {} : object(value, 'arguments');
}
function unique<T>(items: T[], key: (item: T) => string): T[] {
  const result = new Map<string, T>();
  for (const item of items) {
    const id = key(item);
    const existing = result.get(id);
    if (existing && canonical(existing) !== canonical(item)) {
      throw new RabbitMQError(
        'TOPOLOGY_CONFLICT',
        `Conflicting definitions for ${id}`,
      );
    }
    result.set(id, item);
  }
  return [...result.values()];
}
export function normalize(input: unknown): Required<Topology> {
  const topology = object(input, 'topology');
  fields(topology, ['exchanges', 'queues', 'bindings']);
  const exchanges = unique(
    entries(topology.exchanges, 'exchanges').map((e): ExchangeDefinition => {
      fields(e, [
        'name',
        'type',
        'durable',
        'autoDelete',
        'internal',
        'arguments',
      ]);
      if (
        typeof e.type !== 'string' ||
        !['direct', 'topic', 'fanout', 'headers'].includes(e.type)
      )
        invalid('Invalid exchange type');
      return {
        name: name(e.name),
        type: e.type as ExchangeDefinition['type'],
        durable: boolean(e.durable, true, 'durable'),
        autoDelete: boolean(e.autoDelete, false, 'autoDelete'),
        internal: boolean(e.internal, false, 'internal'),
        arguments: args(e.arguments),
      };
    }),
    (e) => e.name,
  );
  const queues = unique(
    entries(topology.queues, 'queues').map((q): QueueDefinition => {
      fields(q, ['name', 'durable', 'autoDelete', 'arguments']);
      return {
        name: name(q.name),
        durable: boolean(q.durable, true, 'durable'),
        autoDelete: boolean(q.autoDelete, false, 'autoDelete'),
        arguments: args(q.arguments),
      };
    }),
    (q) => q.name,
  );
  const bindings = unique(
    entries(topology.bindings, 'bindings').map((b): BindingDefinition => {
      fields(b, ['queue', 'exchange', 'routingKey', 'arguments']);
      if (
        typeof b.routingKey !== 'string' ||
        Buffer.byteLength(b.routingKey) > 255
      )
        invalid('Invalid routing key');
      return {
        queue: name(b.queue),
        exchange: name(b.exchange),
        routingKey: b.routingKey,
        arguments: args(b.arguments),
      };
    }),
    bindingId,
  );
  const queueNames = new Set(queues.map((q) => q.name));
  const exchangeNames = new Set(exchanges.map((e) => e.name));
  for (const b of bindings) {
    if (!queueNames.has(b.queue) || !exchangeNames.has(b.exchange))
      invalid(
        `Binding references undeclared queue/exchange: ${b.queue} / ${b.exchange}`,
      );
  }
  const result = { exchanges, queues, bindings };
  canonical(result);
  return result;
}
export function bindingId(binding: BindingDefinition): string {
  return createHash('sha256')
    .update(canonical({ ...binding, arguments: binding.arguments ?? {} }))
    .digest('hex');
}
