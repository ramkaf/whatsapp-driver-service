import { Injectable } from '@nestjs/common';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import type {
  AuthenticationState,
  SignalDataTypeMap,
  SignalDataSet,
} from '@whiskeysockets/baileys';
import { Prisma, PrismaService } from '@libs/prisma';

export interface AuthContext {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  flush: () => Promise<void>;
  close: () => Promise<void>;
}

function encode(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, BufferJSON.replacer),
  ) as Prisma.InputJsonValue;
}
function decode<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), BufferJSON.reviver) as T;
}

// اطلاعات هویت و کلیدهای واتساپ را به‌ترتیب در دیتابیس ذخیره، بازیابی و پاک می‌کند.
@Injectable()
export class AuthStateService {
  constructor(private readonly prisma: PrismaService) {}

  async hasIdentity(sessionId: string): Promise<boolean> {
    const stored = await this.prisma.waAuthCreds.findUnique({
      where: { sessionId },
    });
    return (
      !!stored && !!decode<AuthenticationState['creds']>(stored.creds).me?.id
    );
  }

  async open(sessionId: string, onFailure: () => void): Promise<AuthContext> {
    const stored = await this.prisma.waAuthCreds.findUnique({
      where: { sessionId },
    });
    const creds = stored
      ? decode<AuthenticationState['creds']>(stored.creds)
      : initAuthCreds();
    let tail: Promise<unknown> = Promise.resolve();
    let failure: unknown;
    let closed = false;
    const run = <T>(operation: () => Promise<T>): Promise<T> => {
      if (closed)
        return Promise.reject(new Error('Authentication store is closed'));
      const task = tail.then(async () => {
        if (failure) throw failure;
        return operation();
      });
      tail = task.catch((error: unknown) => {
        if (!failure) {
          failure = error;
          onFailure();
        }
      });
      return task;
    };
    const flush = async () => {
      await tail;
      if (failure) throw failure;
    };
    const saveCreds = () => {
      const snapshot = encode(creds);
      return run(async () => {
        await this.prisma.waAuthCreds.upsert({
          where: { sessionId },
          create: { sessionId, creds: snapshot },
          update: { creds: snapshot },
        });
      });
    };
    const state: AuthenticationState = {
      creds,
      keys: {
        get: <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) =>
          run(async () => {
            const rows = await this.prisma.waAuthKey.findMany({
              where: { sessionId, type, keyId: { in: ids } },
            });
            const values: Record<string, SignalDataTypeMap[T]> = {};
            for (const row of rows) {
              let value = decode<SignalDataTypeMap[T]>(row.value);
              if (type === 'app-state-sync-key')
                value = proto.Message.AppStateSyncKeyData.fromObject(
                  value as object,
                ) as unknown as SignalDataTypeMap[T];
              values[row.keyId] = value;
            }
            return values;
          }),
        set: (data: SignalDataSet) => {
          // Snapshot before yielding: Baileys can mutate its objects after emitting an event.
          const entries = Object.entries(data).flatMap(([type, keys]) =>
            Object.entries(keys ?? {}).map(([keyId, value]) => ({
              type,
              keyId,
              value: value == null ? null : encode(value),
            })),
          );
          return run(async () => {
            await this.prisma.$transaction(
              entries.map(({ type, keyId, value }) =>
                value === null
                  ? this.prisma.waAuthKey.deleteMany({
                      where: { sessionId, type, keyId },
                    })
                  : this.prisma.waAuthKey.upsert({
                      where: {
                        sessionId_type_keyId: { sessionId, type, keyId },
                      },
                      create: { sessionId, type, keyId, value },
                      update: { value },
                    }),
              ),
            );
          });
        },
      },
    };
    if (!stored) await saveCreds();
    return {
      state,
      saveCreds,
      flush,
      close: async () => {
        closed = true;
        await flush();
      },
    };
  }

  async clear(sessionId: string): Promise<void> {
    // Only the manager calls this, after fencing and draining the socket/store.
    await this.prisma.$transaction([
      this.prisma.waAuthKey.deleteMany({ where: { sessionId } }),
      this.prisma.waAuthCreds.deleteMany({ where: { sessionId } }),
    ]);
  }
}
