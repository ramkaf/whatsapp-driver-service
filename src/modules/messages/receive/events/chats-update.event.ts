import type { Prisma } from '@database/client.js';
import { Injectable } from '@nestjs/common';
import { InboxEventHandler } from '../interfaces/inbox-event-handler.ts';

@Injectable()
export class ChatsUpdateEventHandler extends InboxEventHandler<'chats.update'> {
  readonly event = 'chats.update' as const;
  protected shouldHandle(_payload: Prisma.InputJsonValue): boolean {
    return false;
  }

  protected normalizePayload(
    payload: Prisma.InputJsonValue,
  ): Prisma.InputJsonValue {
    return payload;
  }
}
