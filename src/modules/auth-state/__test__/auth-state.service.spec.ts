import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferJSON, proto } from '@whiskeysockets/baileys';
import type { AuthenticationState } from '@whiskeysockets/baileys';
import type { PrismaService } from '@libs/prisma';
import { AuthStateService } from '../providers/auth-state.service.ts';

function database() {
  const credentials = new Map<string, unknown>();
  const keys = new Map<string, { keyId: string; value: unknown }>();
  const waAuthCreds = {
    findUnique: vi.fn(async ({ where }: { where: { sessionId: string } }) =>
      credentials.has(where.sessionId)
        ? { creds: credentials.get(where.sessionId) }
        : null,
    ),
    upsert: vi.fn(
      async ({
        where,
        create,
        update,
      }: {
        where: { sessionId: string };
        create: { creds: unknown };
        update: { creds: unknown };
      }) => {
        credentials.set(
          where.sessionId,
          credentials.has(where.sessionId) ? update.creds : create.creds,
        );
      },
    ),
    deleteMany: vi.fn(async ({ where }: { where: { sessionId: string } }) => {
      credentials.delete(where.sessionId);
    }),
  };
  const waAuthKey = {
    findMany: vi.fn(
      async ({
        where,
      }: {
        where: { sessionId: string; type: string; keyId: { in: string[] } };
      }) =>
        where.keyId.in.flatMap((keyId) => {
          const value = keys.get(`${where.sessionId}:${where.type}:${keyId}`);
          return value ? [value] : [];
        }),
    ),
    upsert: vi.fn(
      async ({
        create,
      }: {
        create: {
          sessionId: string;
          type: string;
          keyId: string;
          value: unknown;
        };
      }) => {
        keys.set(`${create.sessionId}:${create.type}:${create.keyId}`, {
          keyId: create.keyId,
          value: create.value,
        });
      },
    ),
    deleteMany: vi.fn(
      async ({
        where,
      }: {
        where: { sessionId: string; type?: string; keyId?: string };
      }) => {
        for (const key of keys.keys()) {
          if (
            where.type && where.keyId
              ? key === `${where.sessionId}:${where.type}:${where.keyId}`
              : key.startsWith(`${where.sessionId}:`)
          )
            keys.delete(key);
        }
      },
    ),
  };
  return {
    credentials,
    keys,
    waAuthCreds,
    waAuthKey,
    $transaction: vi.fn(async (operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
  };
}

describe('AuthStateService', () => {
  let db: ReturnType<typeof database>;
  let service: AuthStateService;
  beforeEach(() => {
    db = database();
    service = new AuthStateService(db as unknown as PrismaService);
  });

  it('checks the persisted identity without creating credentials or mixing sessions', async () => {
    await expect(service.hasIdentity('missing')).resolves.toBe(false);
    expect(db.waAuthCreds.upsert).not.toHaveBeenCalled();
    const one = await service.open('one', vi.fn());
    await expect(service.hasIdentity('one')).resolves.toBe(false);
    one.state.creds.me = {
      id: '989121234567:1@s.whatsapp.net',
      name: 'Account',
    };
    await one.saveCreds();
    await expect(service.hasIdentity('one')).resolves.toBe(true);
    await expect(service.hasIdentity('two')).resolves.toBe(false);
    await one.close();
  });

  it('clears credentials and keys together only for the requested session', async () => {
    const one = await service.open('one', vi.fn());
    const two = await service.open('two', vi.fn());
    await one.state.keys.set({ session: { key: Buffer.from([1]) } });
    await two.state.keys.set({ session: { key: Buffer.from([2]) } });
    await one.close();
    db.$transaction.mockClear();
    await service.clear('one');
    expect(db.credentials.has('one')).toBe(false);
    expect(db.keys.has('one:session:key')).toBe(false);
    expect(db.credentials.has('two')).toBe(true);
    expect(db.keys.has('two:session:key')).toBe(true);
    expect(db.$transaction).toHaveBeenCalledExactlyOnceWith([
      expect.any(Promise),
      expect.any(Promise),
    ]);
    await two.close();
  });

  it('creates durable initial credentials and restores binary data per session', async () => {
    const first = await service.open('one', vi.fn());
    const second = await service.open('two', vi.fn());
    expect(first.state.creds.noiseKey.private).not.toEqual(
      second.state.creds.noiseKey.private,
    );
    await first.close();
    const restored = await service.open('one', vi.fn());
    expect(Buffer.from(restored.state.creds.noiseKey.private)).toEqual(
      Buffer.from(first.state.creds.noiseKey.private),
    );
    expect(Buffer.isBuffer(restored.state.creds.noiseKey.private)).toBe(true);
    expect(db.waAuthCreds.upsert).toHaveBeenCalledTimes(2);
  });

  it('persists Uint8Array and Buffer keys, retrieves and deletes them in isolation', async () => {
    const one = await service.open('one', vi.fn());
    const two = await service.open('two', vi.fn());
    await one.state.keys.set({
      session: { abc: new Uint8Array([1, 2, 3]), ABC: Buffer.from([4]) },
    });
    await two.state.keys.set({ session: { abc: Buffer.from([9]) } });
    const data = await one.state.keys.get('session', ['abc', 'ABC']);
    expect(Buffer.from(data.abc!)).toEqual(Buffer.from([1, 2, 3]));
    expect(Buffer.from(data.ABC!)).toEqual(Buffer.from([4]));
    await one.state.keys.set({ session: { abc: null } });
    expect(await one.state.keys.get('session', ['abc'])).toEqual({});
    expect(
      Buffer.from((await two.state.keys.get('session', ['abc'])).abc!),
    ).toEqual(Buffer.from([9]));
  });

  it('rehydrates protobuf app state keys using the supported Baileys helper', async () => {
    const store = await service.open('one', vi.fn());
    const value = proto.Message.AppStateSyncKeyData.fromObject({
      keyData: Buffer.from([7, 8]),
    });
    await store.state.keys.set({ 'app-state-sync-key': { key: value } });
    const restored = await store.state.keys.get('app-state-sync-key', ['key']);
    expect(restored.key).toBeInstanceOf(proto.Message.AppStateSyncKeyData);
    expect(Buffer.from(restored.key!.keyData!)).toEqual(Buffer.from([7, 8]));
  });

  it('serializes writes and snapshots credentials before later mutations', async () => {
    const store = await service.open('one', vi.fn());
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    db.waAuthCreds.upsert.mockImplementationOnce(async () => blocked);
    store.state.creds.nextPreKeyId = 10;
    const first = store.saveCreds();
    store.state.creds.nextPreKeyId = 11;
    const second = store.saveCreds();
    await Promise.resolve();
    expect(db.waAuthCreds.upsert).toHaveBeenCalledTimes(2);
    release();
    await Promise.all([first, second]);
    const calls = db.waAuthCreds.upsert.mock.calls;
    expect(
      (calls[1]![0].update.creds as AuthenticationState['creds']).nextPreKeyId,
    ).toBe(10);
    expect(
      (calls[2]![0].update.creds as AuthenticationState['creds']).nextPreKeyId,
    ).toBe(11);
  });

  it('reports database write failures and prevents later writes masking a lost update', async () => {
    const failed = vi.fn();
    const store = await service.open('one', failed);
    const error = new Error('Database unavailable');
    db.$transaction.mockRejectedValueOnce(error);
    await expect(
      store.state.keys.set({ session: { key: Buffer.from([1]) } }),
    ).rejects.toBe(error);
    await expect(store.flush()).rejects.toBe(error);
    await expect(store.saveCreds()).rejects.toBe(error);
    expect(failed).toHaveBeenCalledOnce();
    expect(db.waAuthCreds.upsert).toHaveBeenCalledTimes(1);
  });

  it('flushes pending writes before closing and rejects stale-generation writes', async () => {
    const store = await service.open('one', vi.fn());
    const write = store.saveCreds();
    await store.close();
    await write;
    await expect(store.saveCreds()).rejects.toThrow('closed');
    await expect(
      store.state.keys.set({ session: { old: Buffer.from([1]) } }),
    ).rejects.toThrow('closed');
  });

  it('propagates initial read failures instead of replacing stored authentication', async () => {
    db.waAuthCreds.findUnique.mockRejectedValueOnce(
      new Error('Database unavailable'),
    );
    await expect(service.open('one', vi.fn())).rejects.toThrow(
      'Database unavailable',
    );
    expect(db.waAuthCreds.upsert).not.toHaveBeenCalled();
  });

  it('supports existing BufferJSON records', async () => {
    const store = await service.open('one', vi.fn());
    db.credentials.set(
      'one',
      JSON.parse(JSON.stringify(store.state.creds, BufferJSON.replacer)),
    );
    const restored = await service.open('one', vi.fn());
    expect(restored.state.creds.registrationId).toBe(
      store.state.creds.registrationId,
    );
  });
});
