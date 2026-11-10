import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'amqplib';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RabbitMQService, RabbitMQModule, RpcPublicError } from '../index.ts';
import type { RabbitMQOptions } from '../index.ts';

const url = process.env.TEST_RABBITMQ_URL;
describe.skipIf(!url)('RabbitMQ + shared JSON integration', () => {
  const id = `module-test-${randomUUID()}`;
  const queue = `${id}.sms`;
  const exchange = `${id}.events`;
  const rpc = `${id}.rpc`;
  const options: RabbitMQOptions = {
    url: url ?? '',
    topologyPath: '',
    requeueDelayMs: 50,
    operationTimeoutMs: 3000,
    reconnect: { initialDelayMs: 200, maxDelayMs: 1000 },
  };
  const topology = {
    exchanges: [{ name: exchange, type: 'direct' }],
    queues: [{ name: queue }, { name: rpc }],
    bindings: [{ queue, exchange, routingKey: 'registered' }],
  };
  const applications: TestingModule[] = [];
  let directory: string;
  let admin: Awaited<ReturnType<typeof connect>>;
  let first: RabbitMQService;
  async function application(config = options) {
    const app = await Test.createTestingModule({
      imports: [RabbitMQModule.forRoot(config)],
    }).compile();
    applications.push(app);
    await app.init(); // Nest invokes onApplicationBootstrap, no manual initialize call.
    return app;
  }
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'rabbitmq-json-integration-'));
    options.topologyPath = join(directory, 'topology.json');
    await writeFile(options.topologyPath, JSON.stringify(topology));
    admin = await connect(options.url);
    admin.on('error', () => undefined);
    first = (await application()).get(RabbitMQService);
  });
  afterAll(async () => {
    await Promise.allSettled(applications.map((app) => app.close()));
    try {
      if (admin) {
        const channel = await admin.createChannel();
        await channel.deleteQueue(queue);
        await channel.deleteQueue(rpc);
        await channel.deleteExchange(exchange);
        await admin.close();
      }
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  });
  it('automatically initializes multiple microservices from the same JSON without losing or duplicating messages', async () => {
    await first.publish(exchange, 'registered', { shared: true });
    await Promise.all([application(), application()]);
    const channel = await admin.createChannel();
    expect((await channel.checkQueue(queue)).messageCount).toBe(1);
    const delivered = await channel.get(queue, { noAck: true });
    expect(delivered && JSON.parse(delivered.content.toString())).toEqual({
      shared: true,
    });
    await channel.close();
  });
  it('rejects incompatible broker settings instead of replacing an existing queue', async () => {
    const path = join(directory, 'conflicting.json');
    await writeFile(
      path,
      JSON.stringify({ queues: [{ name: queue, durable: false }] }),
    );
    const app = await Test.createTestingModule({
      imports: [RabbitMQModule.forRoot({ ...options, topologyPath: path })],
    }).compile();
    try {
      await expect(app.init()).rejects.toThrow();
    } finally {
      await app.close();
    }
    const channel = await admin.createChannel();
    await channel.checkQueue(queue);
    await channel.close();
  });
  it('delivers persistent JSON with a stable ID and trace context, then delays failed Inbox delivery', async () => {
    const received: string[] = [];
    let attempts = 0;
    const consumer = await first.consume<{ text: string }>(
      queue,
      async (data, context) => {
        attempts++;
        expect(context.headers.traceparent).toMatch(/^00-/);
        expect(data.text).toBe('hello');
        if (attempts === 1) throw new Error('temporary Inbox failure');
        received.push(context.messageId);
      },
      { prefetch: 1 },
    );
    await first.publish(
      exchange,
      'registered',
      { text: 'hello' },
      { messageId: 'stable-outbox-id' },
    );
    await vi.waitFor(() => expect(received).toEqual(['stable-outbox-id']), {
      timeout: 5000,
    });
    expect(attempts).toBe(2);
    await first.stopConsumer(consumer);
  });
  it('fails unroutable publications and does not implicitly create a queue', async () => {
    await expect(first.send(`${id}.missing`, {})).rejects.toMatchObject({
      code: 'UNROUTABLE',
    });
  });
  it('handles concurrent RPC success and sanitized errors', async () => {
    const consumer = await first.handleRequest<{ value: number }>(
      rpc,
      async (data) => {
        if (data.value === -1) throw new Error('secret');
        if (data.value === -2) throw new RpcPublicError('invalid value');
        return data.value * 2;
      },
    );
    expect(
      await Promise.all(
        [1, 2, 3].map((value) => first.request(rpc, { value })),
      ),
    ).toEqual([2, 4, 6]);
    await expect(first.request(rpc, { value: -1 })).rejects.toThrow(
      'Remote handler failed',
    );
    await expect(first.request(rpc, { value: -2 })).rejects.toThrow(
      'invalid value',
    );
    await first.stopConsumer(consumer);
    await expect(
      first.request(rpc, {}, { timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: 'RPC_TIMEOUT' });
  });
  it.skipIf(!process.env.TEST_RABBITMQ_CONTAINER)(
    'recovers consumers and durable messages after a real broker restart',
    async () => {
      const received: string[] = [];
      const consumer = await first.consume<{ text: string }>(queue, (data) => {
        received.push(data.text);
      });
      await first.send(queue, { text: 'before restart' });
      await vi.waitFor(() => expect(received).toContain('before restart'));
      // No consumer on the RPC queue: this persistent message must survive restart.
      await first.send(rpc, { marker: 'survives restart' });
      await promisify(execFile)('docker', [
        'restart',
        process.env.TEST_RABBITMQ_CONTAINER!,
      ]);
      await vi.waitFor(
        async () => {
          admin = await connect(options.url);
          admin.on('error', () => undefined);
        },
        { timeout: 45000, interval: 250 },
      );
      await vi.waitFor(
        async () => {
          await first.initialize();
        },
        { timeout: 45000, interval: 250 },
      );
      await first.send(queue, { text: 'after restart' });
      await vi.waitFor(() => expect(received).toContain('after restart'), {
        timeout: 5000,
      });
      await first.stopConsumer(consumer);
      const messages: unknown[] = [];
      const persistentConsumer = await first.consume(rpc, (data) => {
        messages.push(data);
      });
      await vi.waitFor(() =>
        expect(messages).toContainEqual({ marker: 'survives restart' }),
      );
      await first.stopConsumer(persistentConsumer);
    },
  );
  it('recreates missing resources from the shared JSON when a new microservice starts', async () => {
    const channel = await admin.createChannel();
    await channel.deleteQueue(queue);
    await channel.deleteExchange(exchange);
    const restarted = (await application()).get(RabbitMQService);
    await restarted.publish(exchange, 'registered', { recreated: true });
    const delivered = await channel.get(queue, { noAck: true });
    expect(delivered && JSON.parse(delivered.content.toString())).toEqual({
      recreated: true,
    });
    await channel.close();
  });
});
