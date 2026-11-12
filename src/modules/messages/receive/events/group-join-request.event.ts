import type { Prisma } from '@database/client.js';
import { Injectable } from '@nestjs/common';
import { InboxEventHandler } from '../interfaces/inbox-event-handler.ts';

/** Receives created, revoked and rejected membership requests. */
@Injectable()
export class GroupJoinRequestEventHandler extends InboxEventHandler<'group.join-request'> {
  readonly event = 'group.join-request' as const;
  protected shouldHandle(_payload: Prisma.InputJsonValue): boolean {
    return false;
  }

  protected normalizePayload(
    payload: Prisma.InputJsonValue,
  ): Prisma.InputJsonValue {
    return payload;
  }
}
