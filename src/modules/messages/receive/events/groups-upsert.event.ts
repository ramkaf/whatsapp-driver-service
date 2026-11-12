import type { Prisma } from '@database/client.js';
import { Injectable } from '@nestjs/common';
import { InboxEventHandler } from '../interfaces/inbox-event-handler.ts';

/** Receives newly discovered groups and their metadata snapshots. */
@Injectable()
export class GroupsUpsertEventHandler extends InboxEventHandler<'groups.upsert'> {
  readonly event = 'groups.upsert' as const;
  protected shouldHandle(_payload: Prisma.InputJsonValue): boolean {
    return false;
  }

  protected normalizePayload(
    payload: Prisma.InputJsonValue,
  ): Prisma.InputJsonValue {
    return payload;
  }
}
