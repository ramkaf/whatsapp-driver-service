import { Injectable, Logger } from '@nestjs/common';
import { jidNormalizedUser } from 'baileys';
import type { GroupMetadata } from 'baileys';
import { WhatsappConnectService } from '../../connection/providers/wa-connect.service.ts';

@Injectable()
export class WhatsappGroupRepository {
  private readonly logger = new Logger(WhatsappGroupRepository.name);
  constructor(private readonly connection: WhatsappConnectService) {}

  async findOne(groupJid: string): Promise<GroupMetadata | null> {
    const socket = this.connection.getSocket();

    try {
      return await socket.groupMetadata(groupJid);
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to fetch group metadata: ${groupJid} | ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return null;
    }
  }

  async findAll(): Promise<GroupMetadata[]> {
    const groups = await this.connection
      .getSocket()
      .groupFetchAllParticipating();
    return Object.values(groups);
  }

  // Only a definite not-found response means false; connection and permission
  // failures must remain visible to the caller.
  async exists(groupJid: string): Promise<boolean> {
    try {
      await this.findOne(groupJid);
      return true;
    } catch (error) {
      const status = (error as { output?: { statusCode?: number } } | null)
        ?.output?.statusCode;
      if (status === 404) return false;
      throw error;
    }
  }

  async isUserAdmin(groupJid: string, userJid: string): Promise<boolean> {
    const group = await this.findOne(groupJid);
    if (!group) return false;
    const normalizedUser = jidNormalizedUser(userJid);
    return group.participants.some((participant) => {
      const matchesUser = [
        participant.id,
        participant.lid,
        participant.phoneNumber,
      ].some((jid) => jid && jidNormalizedUser(jid) === normalizedUser);
      return (
        matchesUser &&
        (participant.admin === 'admin' || participant.admin === 'superadmin')
      );
    });
  }
}
