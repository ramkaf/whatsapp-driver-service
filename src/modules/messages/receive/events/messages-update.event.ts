import type { Prisma } from '@database/client.js';
import { Injectable } from '@nestjs/common';
import { InboxEventHandler } from '../interfaces/inbox-event-handler.ts';

@Injectable()
export class MessagesUpdateEventHandler extends InboxEventHandler<'messages.update'> {
  readonly event = 'messages.update' as const;
  protected shouldHandle(_payload: Prisma.InputJsonValue): boolean {
    return false;
  }

  protected normalizePayload(
    payload: Prisma.InputJsonValue,
  ): Prisma.InputJsonValue {
    return payload;
  }
}
