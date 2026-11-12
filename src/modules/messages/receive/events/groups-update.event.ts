import type { Prisma } from '@database/client.js';
import { Injectable } from '@nestjs/common';
import { InboxEventHandler } from '../interfaces/inbox-event-handler.ts';

/** Receives group name, description, invite-link and permission changes. */
@Injectable()
export class GroupsUpdateEventHandler extends InboxEventHandler<'groups.update'> {
  readonly event = 'groups.update' as const;
  protected shouldHandle(_payload: Prisma.InputJsonValue): boolean {
    return false;
  }

  protected normalizePayload(
    payload: Prisma.InputJsonValue,
  ): Prisma.InputJsonValue {
    return payload;
  }
}
