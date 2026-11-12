import type { Prisma } from '@database/client.js';
import { Injectable } from '@nestjs/common';
import { InboxEventHandler } from '../interfaces/inbox-event-handler.ts';

/** Handles add/remove/promote/demote/modify; Baileys emits remove for both leave and removal. */
@Injectable()
export class GroupParticipantsUpdateEventHandler extends InboxEventHandler<'group-participants.update'> {
  readonly event = 'group-participants.update' as const;

  protected shouldHandle(_payload: Prisma.InputJsonValue): boolean {
    return false;
  }

  protected normalizePayload(
    payload: Prisma.InputJsonValue,
  ): Prisma.InputJsonValue {
    return payload;
  }
}
