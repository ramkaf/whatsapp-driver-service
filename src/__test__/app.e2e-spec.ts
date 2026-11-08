import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { HttpException, NotFoundException } from '@nestjs/common';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../app.module.ts';
import { PrismaService } from '@libs/prisma';
import { configuer, RedisService, EEnvironment } from '@libs/common';
import type { IAppConfig } from '@libs/common';
import { SessionRepository } from '../modules/sessions/session.repository.ts';
import { SessionManagerService } from '../modules/connection/providers/session/session-manager.service.ts';
import { PersistenceFilter } from '../modules/sessions/filters/persistence.filter.ts';

const token = 'test-administration-token-with-at-least-32-characters';
const config = {
  whatsapp: { adminApiKey: token, maxSessions: 50, watchdogIntervalMs: 30000 },
  redis: {},
  databaseUrl: 'mysql://test:test@localhost:3306/test',
  nodeEnv: EEnvironment.Test,
  name: 'test',
  workingDirectory: process.cwd(),
  backendDomain: 'http://localhost',
  corsOrigins: ['*'],
  port: 0,
  apiPrefix: '',
} as IAppConfig;

describe('Session administration API (e2e, external services mocked)', () => {
  let app: INestApplication;
  let rows: Map<string, Record<string, unknown>>;
  let manager: {
    start: ReturnType<typeof vi.fn>;
    snapshot: ReturnType<typeof vi.fn>;
    preparePairing: ReturnType<typeof vi.fn>;
    requestPairingCode: ReturnType<typeof vi.fn>;
    pairing: ReturnType<typeof vi.fn>;
    restart: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    inspectConnections: ReturnType<typeof vi.fn>;
  };
  beforeEach(async () => {
    rows = new Map();
    const repository = {
      count: vi.fn(async () => rows.size),
      create: vi.fn(async (data: object) => {
        const row = {
          id: 'session-one',
          enabled: true,
          status: 'CONNECTING',
          ...data,
        };
        rows.set('session-one', row);
        return row;
      }),
      require: vi.fn(async (id: string) => {
        const row = rows.get(id);
        if (!row) throw new NotFoundException('Session not found');
        return row;
      }),
      list: vi.fn(async () => [...rows.values()]),
    };
    manager = {
      start: vi.fn().mockResolvedValue(undefined),
      snapshot: vi
        .fn()
        .mockReturnValue({ status: 'CONNECTING', connected: false }),
      preparePairing: vi.fn().mockResolvedValue(undefined),
      requestPairingCode: vi.fn().mockResolvedValue({
        code: 'TESTCODE',
        expiresAt: new Date().toISOString(),
      }),
      pairing: vi.fn().mockReturnValue({
        qr: 'raw-qr-string',
        expiresAt: new Date().toISOString(),
      }),
      restart: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn(async (id: string) => {
        rows.delete(id);
      }),
      inspectConnections: vi.fn().mockResolvedValue(undefined),
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(configuer.KEY)
      .useValue(config)
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(RedisService)
      .useValue({ client: {} })
      .overrideProvider(SessionRepository)
      .useValue(repository)
      .overrideProvider(SessionManagerService)
      .useValue(manager)
      .compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new PersistenceFilter());
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });
  const create = (method: 'QR' | 'CODE' = 'QR') =>
    request(app.getHttpServer())
      .post('/sessions')
      .auth(token, { type: 'bearer' })
      .send({
        name: 'WhatsApp 01',
        phone: '989121234567',
        pairingMethod: method,
      });

  it('protects session, pairing and health endpoints', async () => {
    await request(app.getHttpServer()).get('/sessions').expect(401);
    await request(app.getHttpServer()).get('/health').expect(401);
    await request(app.getHttpServer())
      .post('/sessions/one/pairing-code')
      .send({})
      .expect(401);
  });
  it('validates DTOs and normalizes phones', async () => {
    await request(app.getHttpServer())
      .post('/sessions')
      .auth(token, { type: 'bearer' })
      .send({ name: '', pairingMethod: 'INVALID', secret: true })
      .expect(400);
    await request(app.getHttpServer())
      .post('/sessions')
      .auth(token, { type: 'bearer' })
      .send({ name: 'x', pairingMethod: 'CODE', phone: '123' })
      .expect(400);
    const response = await create('CODE').expect(201);
    expect(response.body.phone).toBe('989121234567');
    expect(response.body).not.toHaveProperty('authCreds');
  });
  it('returns pairing codes and QR data only through authenticated no-store endpoints', async () => {
    await create('QR').expect(201);
    const qr = await request(app.getHttpServer())
      .get('/sessions/session-one/qr')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(qr.body.qr).toBe('raw-qr-string');
    expect(qr.headers['cache-control']).toBe('no-store');
    const code = await request(app.getHttpServer())
      .post('/sessions/session-one/pairing-code')
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(200);
    expect(code.body.code).toBe('TESTCODE');
    expect(code.headers['cache-control']).toBe('no-store');
  });
  it('starts QR pairing explicitly and rejects unauthenticated requests', async () => {
    await request(app.getHttpServer())
      .post('/sessions/session-one/qr')
      .send({})
      .expect(401);
    await create('QR').expect(201);
    const response = await request(app.getHttpServer())
      .post('/sessions/session-one/qr')
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(200);
    expect(manager.preparePairing).toHaveBeenCalledWith('session-one', 'QR');
    expect(response.body.qr).toBe('raw-qr-string');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('does not expose a separate pairing-method endpoint', async () => {
    await create('QR').expect(201);
    await request(app.getHttpServer())
      .post('/sessions/session-one/pairing-method')
      .auth(token, { type: 'bearer' })
      .send({ pairingMethod: 'CODE', phone: '989121234567' })
      .expect(404);
    expect(manager.preparePairing).not.toHaveBeenCalled();
  });

  it('requires valid phone numbers for CODE while QR may omit a phone', async () => {
    for (const phone of [
      undefined,
      null,
      '',
      '123',
      'call +989121234567',
      989121234567,
    ]) {
      await request(app.getHttpServer())
        .post('/sessions')
        .auth(token, { type: 'bearer' })
        .send({ name: 'test', pairingMethod: 'CODE', phone })
        .expect(400);
    }
    await request(app.getHttpServer())
      .post('/sessions')
      .auth(token, { type: 'bearer' })
      .send({ name: 'QR test', pairingMethod: 'QR' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/sessions/session-one/pairing-code')
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(400);
    for (const phone of [null, '', '123', 'call +989121234567']) {
      await request(app.getHttpServer())
        .post('/sessions/session-one/pairing-code')
        .auth(token, { type: 'bearer' })
        .send({ phone })
        .expect(400);
    }
    expect(manager.requestPairingCode).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post('/sessions/session-one/pairing-code')
      .auth(token, { type: 'bearer' })
      .send({ phone: '+98 912 123 4567' })
      .expect(200);
    expect(manager.requestPairingCode).toHaveBeenCalledWith(
      'session-one',
      '989121234567',
    );
  });

  it('returns consistent rate-limit errors and does not expose internal secrets', async () => {
    await create('CODE').expect(201);
    manager.requestPairingCode.mockRejectedValueOnce(
      new HttpException('Pairing requests are rate limited', 429),
    );
    const rate = await request(app.getHttpServer())
      .post('/sessions/session-one/pairing-code')
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(429);
    expect(rate.body).toEqual({
      statusCode: 429,
      message: 'Pairing requests are rate limited',
    });
    manager.restart.mockRejectedValueOnce(new Error('private-auth-material'));
    const failed = await request(app.getHttpServer())
      .post('/sessions/session-one/reconnect')
      .auth(token, { type: 'bearer' })
      .expect(500);
    expect(failed.body.message).toBe('Internal server error');
    expect(JSON.stringify(failed.body)).not.toContain('private-auth-material');
  });

  it('exposes status, aggregate health and lifecycle controls', async () => {
    await create().expect(201);
    await request(app.getHttpServer())
      .get('/sessions/session-one')
      .auth(token, { type: 'bearer' })
      .expect(200);
    await request(app.getHttpServer())
      .get('/sessions/session-one/status')
      .auth(token, { type: 'bearer' })
      .expect(404);
    const health = await request(app.getHttpServer())
      .get('/health')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(health.body.sessions.total).toBe(1);
    for (const action of ['reconnect', 'disconnect', 'logout']) {
      await request(app.getHttpServer())
        .post(`/sessions/session-one/${action}`)
        .auth(token, { type: 'bearer' })
        .expect(200);
    }
    await request(app.getHttpServer())
      .delete('/sessions/session-one')
      .auth(token, { type: 'bearer' })
      .expect(204);
    await request(app.getHttpServer())
      .get('/sessions/session-one')
      .auth(token, { type: 'bearer' })
      .expect(404);
  });
});
