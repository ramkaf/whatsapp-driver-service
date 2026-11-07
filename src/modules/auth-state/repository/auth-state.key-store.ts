
import { Injectable } from '@nestjs/common';
import {
  proto,
  type SignalDataTypeMap,
  type SignalDataSet,
  type SignalKeyStore,
} from '@whiskeysockets/baileys';
import { PrismaService } from '@libs/prisma';
import { AuthStateQueue } from '../infrastructure/auth-state.queue.ts';
import { AuthStateSerializer } from './auth-state.serializer.ts';

@Injectable()
export class AuthStateKeyStore implements SignalKeyStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionId: string,
    private readonly queue: AuthStateQueue,
  ) {}

  async get<T extends keyof SignalDataTypeMap>(
    type: T,
    ids: string[],
  ): Promise<Record<string, SignalDataTypeMap[T]>> {
    if (ids.length === 0) {
      return {};
    }

    return this.queue.run(async () => {
      const rows = await this.prisma.waAuthKey.findMany({
        where: {
          sessionId: this.sessionId,
          type,
          keyId: {
            in: ids,
          },
        },
      });

      const values: Record<string, SignalDataTypeMap[T]> = {};

      for (const row of rows) {
        let value = AuthStateSerializer.decode<
          SignalDataTypeMap[T]
        >(row.value);

        if (type === 'app-state-sync-key') {
          value = proto.Message.AppStateSyncKeyData.fromObject(
            value as object,
          ) as unknown as SignalDataTypeMap[T];
        }

        values[row.keyId] = value;
      }

      return values;
    });
  }

  set(data: SignalDataSet): Promise<void> {
    // Snapshot values before entering the queue.
    const entries = Object.entries(data).flatMap(
      ([type, keys]) =>
        Object.entries(keys ?? {}).map(([keyId, value]) => ({
          type,
          keyId,
          value:
            value == null
              ? null
              : AuthStateSerializer.encode(value),
        })),
    );

    if (entries.length === 0) {
      return Promise.resolve();
    }

    return this.queue.run(async () => {
      const operations = entries.map(
        ({ type, keyId, value }) => {
          const where = {
            sessionId: this.sessionId,
            type,
            keyId,
          };

          if (value === null) {
            return this.prisma.waAuthKey.deleteMany({
              where,
            });
          }

          return this.prisma.waAuthKey.upsert({
            where: {
              sessionId_type_keyId: where,
            },
            create: {
              ...where,
              value,
            },
            update: {
              value,
            },
          });
        },
      );

      await this.prisma.$transaction(operations);
    });
  }
}
