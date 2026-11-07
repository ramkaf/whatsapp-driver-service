import { BufferJSON } from '@whiskeysockets/baileys';
import { Prisma } from '@libs/prisma';

export class AuthStateSerializer {
  static encode(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(
      JSON.stringify(value, BufferJSON.replacer),
    ) as Prisma.InputJsonValue;
  }

  static decode<T>(value: unknown): T {
    return JSON.parse(JSON.stringify(value), BufferJSON.reviver) as T;
  }
}
