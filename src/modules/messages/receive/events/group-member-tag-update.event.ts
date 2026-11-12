import type { Prisma } from '@database/client.js';
import { Injectable } from '@nestjs/common';
import { InboxEventHandler } from '../interfaces/inbox-event-handler.ts';

/** Receives changes to a member's label within a group. */
@Injectable()
export class GroupMemberTagUpdateEventHandler extends InboxEventHandler<'group.member-tag.update'> {
  readonly event = 'group.member-tag.update' as const;

  protected shouldHandle(_payload: Prisma.InputJsonValue): boolean {
    return false;
  }

  protected normalizePayload(
    payload: Prisma.InputJsonValue,
  ): Prisma.InputJsonValue {
    return payload;
  }
}
