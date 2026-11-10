import { EventEmitter } from 'node:events';
import type { connect } from 'amqplib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RabbitMQService } from '../rabbitmq.service.ts';
import { RpcPublicError } from '../common/error/rabbitmq.error.ts';
import type { RabbitMQOptions } from '../common/interface/index.ts';

class FakeChannel extends EventEmitter {
  assertExchange = vi.fn(async () => ({}));
  assertQueue = vi.fn(async (name: string) => ({
    queue: name || 'private.reply',
  }));
  checkQueue = vi.fn(async () => ({}));
  bindQueue = vi.fn(async () => ({}));
  unbindQueue = vi.fn(async () => ({}));
  prefetch = vi.fn(async () => ({}));
  callback?: (message: unknown) => void;
  consume = vi.fn(
    async (_queue: string, callback: (message: unknown) => void) => {
      this.callback = callback;
      return { consumerTag: 'tag' };
    },
  );
  cancel = vi.fn(async () => ({}));
  ack = vi.fn();
  nack = vi.fn();
  close = vi.fn(async () => {
    this.emit('close');
  });
  waitForConfirms = vi.fn(async () => undefined);
  publish = vi.fn(
    (
      _exchange: string,
      _key: string,
      _data: Buffer,
      _options: Record<string, unknown>,
      callback: (error: Error | null) => void,
    ) => {
      queueMicrotask(() => callback(null));
      return true;
    },
  );
}
class FakeConnection extends EventEmitter {
  channels: FakeChannel[] = [];
  publisher = new FakeChannel();
  createChannel = vi.fn(async () => {
    const channel = new FakeChannel();
    this.channels.push(channel);
    return channel;
  });
  createConfirmChannel = vi.fn(async () => this.publisher);
  close = vi.fn(async () => {
    this.emit('close');
    for (const channel of this.channels) channel.emit('close');
    this.publisher.emit('close');
  });
}
const services: RabbitMQService[] = [];
function setup(config: Partial<RabbitMQOptions> = {}) {
  const connections: FakeConnection[] = [];
  const connector = vi.fn(async () => {
    const connection = new FakeConnection();
    connections.push(connection);
    return connection;
  });
  const service = new RabbitMQService(
    {
      url: 'amqp://unused',
      topologyPath: 'config/rabbitmq.topology.json',
      reconnect: { initialDelayMs: 10, maxDelayMs: 20 },
      operationTimeoutMs: 100,
      shutdownTimeoutMs: 100,
      requeueDelayMs: 20,
      ...config,
    },
    connector as unknown as typeof connect,
  );
  services.push(service);
  return { service, connector, connections };
}
function message(data: unknown = {}, properties: Record<string, unknown> = {}) {
  return {
    content: Buffer.from(JSON.stringify(data)),
    properties: { messageId: 'stable-id', headers: {}, ...properties },
    fields: { redelivered: false },
  };
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.allSettled(
    services.splice(0).map((service) => service.close()),
  );
});

describe('RabbitMQService', () => {
  it('shares one connection across concurrent sends and preserves message IDs', async () => {
    const { service, connector, connections } = setup();
    await Promise.all(
      Array.from({ length: 20 }, () =>
        service.send('sms', {}, { messageId: 'outbox-id' }),
      ),
    );
    expect(connector).toHaveBeenCalledTimes(1);
    expect(connections[0]!.createConfirmChannel).toHaveBeenCalledTimes(1);
    expect(connections[0]!.publisher.publish.mock.calls[0]![3]).toMatchObject({
      messageId: 'outbox-id',
      mandatory: true,
      persistent: true,
    });
  });
  it('automatically prepares the complete JSON topology once during bootstrap', async () => {
    const { service, connections } = setup();
    await Promise.all([service.onApplicationBootstrap(), service.initialize()]);
    const control = connections[0]!.channels[0]!;
    expect(control.assertExchange).toHaveBeenCalledWith(
      'users',
      'direct',
      expect.objectContaining({ durable: true }),
    );
    expect(control.assertQueue).toHaveBeenCalledTimes(1);
    expect(control.bindQueue).toHaveBeenCalledTimes(1);
    expect(control.assertExchange.mock.invocationCallOrder[0]).toBeLessThan(
      control.assertQueue.mock.invocationCallOrder[0]!,
    );
    expect(control.assertQueue.mock.invocationCallOrder.at(-1)).toBeLessThan(
      control.bindQueue.mock.invocationCallOrder[0]!,
    );
  });
  it('fails before connecting when the shared JSON file is missing', async () => {
    const { service, connector } = setup({
      topologyPath: '/tmp/nonexistent-rabbitmq-topology-test.json',
    });
    await expect(service.initialize()).rejects.toMatchObject({
      code: 'TOPOLOGY_READ_FAILED',
    });
    expect(connector).not.toHaveBeenCalled();
  });
  it('rejects returned mandatory publications even when the broker confirms them', async () => {
    const { service, connections } = setup();
    await service.initialize();
    const publisher = connections[0]!.publisher;
    publisher.publish.mockImplementation(
      (_exchange, _key, _data, options, callback) => {
        queueMicrotask(() => {
          publisher.emit('return', {
            properties: { headers: options.headers },
          });
          callback(null);
        });
        return true;
      },
    );
    await expect(service.send('missing', {})).rejects.toMatchObject({
      code: 'UNROUTABLE',
    });
  });
  it('does not retry an unconfirmed publication', async () => {
    const { service, connections } = setup();
    await service.initialize();
    connections[0]!.publisher.publish.mockImplementation(() => true);
    await expect(
      service.send('sms', {}, { timeoutMs: 10 }),
    ).rejects.toMatchObject({ code: 'CONFIRM_TIMEOUT' });
    expect(connections[0]!.publisher.publish).toHaveBeenCalledTimes(1);
  });
  it('respects backpressure until drain', async () => {
    const { service, connections } = setup();
    await service.initialize();
    const publisher = connections[0]!.publisher;
    publisher.publish.mockImplementation((_e, _k, _d, _o, callback) => {
      queueMicrotask(() => callback(null));
      return false;
    });
    await service.send('sms', {});
    const second = service.send('sms', {});
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    publisher.emit('drain');
    await second;
    expect(publisher.publish).toHaveBeenCalledTimes(2);
  });
  it('acks only after the Inbox handler completes', async () => {
    const { service, connections } = setup();
    let complete!: () => void;
    await service.consume(
      'sms',
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const channel = connections[0]!.channels[1]!;
    channel.callback!(message());
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    expect(channel.ack).not.toHaveBeenCalled();
    complete();
    await vi.waitFor(() => expect(channel.ack).toHaveBeenCalledTimes(1));
  });
  it('delays requeue after Inbox persistence failure', async () => {
    const { service, connections } = setup();
    await service.consume('sms', async () => {
      throw new Error('database offline');
    });
    const channel = connections[0]!.channels[1]!;
    channel.callback!(message());
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(channel.nack).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, true),
    );
    expect(channel.ack).not.toHaveBeenCalled();
  });
  it('restores consumers on connection loss without resending publications', async () => {
    const { service, connections, connector } = setup();
    await service.consume('sms', async () => undefined, { id: 'sms-worker' });
    await service.send('sms', {});
    connections[0]!.emit('close');
    await vi.waitFor(() => expect(connector).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(connections[1]!.channels[1]!.consume).toHaveBeenCalledTimes(1),
    );
    expect(connections[1]!.publisher.publish).not.toHaveBeenCalled();
  });
  it('correlates RPC responses and ignores duplicate replies', async () => {
    const { service, connections } = setup();
    await service.initialize();
    connections[0]!.publisher.publish.mockImplementation(
      (_e, _k, _d, options, callback) => {
        queueMicrotask(() => {
          callback(null);
          const reply = message(
            { ok: true, data: { available: 5 } },
            { correlationId: options.correlationId },
          );
          connections[0]!.channels[1]!.callback!(reply);
          connections[0]!.channels[1]!.callback!(reply);
        });
        return true;
      },
    );
    await expect(service.request('inventory', {})).resolves.toEqual({
      available: 5,
    });
    expect(connections[0]!.channels[1]!.assertQueue).toHaveBeenCalledWith('', {
      durable: false,
      exclusive: true,
      autoDelete: true,
    });
  });
  it('bounds pending RPCs and frees capacity on timeout', async () => {
    const { service } = setup({ maxPendingRequests: 1, rpcTimeoutMs: 20 });
    await service.initialize();
    const first = service.request('sms', {});
    const failure = expect(first).rejects.toMatchObject({
      code: 'RPC_TIMEOUT',
    });
    await expect(service.request('sms', {})).rejects.toMatchObject({
      code: 'RPC_LIMIT',
    });
    await failure;
    await expect(service.request('sms', {})).rejects.toMatchObject({
      code: 'RPC_TIMEOUT',
    });
  });
  it('sanitizes RPC errors but allows explicit public errors', async () => {
    const { service, connections } = setup();
    await service.handleRequest('sms', async () => {
      throw new Error('password=secret');
    });
    connections[0]!.channels[1]!.callback!(
      message({}, { replyTo: 'reply', correlationId: 'request' }),
    );
    await vi.waitFor(() =>
      expect(connections[0]!.publisher.publish).toHaveBeenCalled(),
    );
    const body = JSON.parse(
      connections[0]!.publisher.publish.mock.calls[0]![2].toString(),
    );
    expect(body).toEqual({ ok: false, error: 'Remote handler failed' });
    expect(new RpcPublicError('Invalid input').message).toBe('Invalid input');
  });
  it('closes a connection when shutdown happens during channel creation', async () => {
    const { service, connector } = setup({ operationTimeoutMs: 1000 });
    const connection = new FakeConnection();
    let finish!: (channel: FakeChannel) => void;
    connection.createConfirmChannel.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    connector.mockResolvedValue(connection);
    const initializing = expect(service.initialize()).rejects.toMatchObject({
      code: 'CLOSED',
    });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await service.close();
    finish(connection.publisher);
    await initializing;
    expect(connection.close).toHaveBeenCalled();
    expect(connector).toHaveBeenCalledTimes(1);
  });
  it('clears pending RPCs after channel loss and accepts requests on the new connection', async () => {
    const { service, connections } = setup({
      maxPendingRequests: 1,
      rpcTimeoutMs: 1000,
    });
    await service.initialize();
    const failure = expect(
      service.request('inventory', {}),
    ).rejects.toMatchObject({ code: 'CONNECTION_LOST' });
    await vi.waitFor(() =>
      expect(connections[0]!.publisher.publish).toHaveBeenCalled(),
    );
    connections[0]!.publisher.emit('close');
    await failure;
    await service.initialize();
    const connection = connections[1]!;
    connection.publisher.publish.mockImplementation(
      (_e, _k, _d, options, callback) => {
        queueMicrotask(() => {
          callback(null);
          connection.channels[1]!.callback!(
            message(
              { ok: true, data: 5 },
              { correlationId: options.correlationId },
            ),
          );
        });
        return true;
      },
    );
    await expect(service.request('inventory', {})).resolves.toBe(5);
  });
  it('rejects duplicate consumer IDs and shuts down idempotently', async () => {
    const { service } = setup();
    await service.consume('sms', async () => undefined, { id: 'worker' });
    await expect(
      service.consume('sms', async () => undefined, { id: 'worker' }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_CONSUMER' });
    await Promise.all([service.close(), service.close()]);
    await expect(service.send('sms', {})).rejects.toMatchObject({
      code: 'CLOSED',
    });
  });
});
