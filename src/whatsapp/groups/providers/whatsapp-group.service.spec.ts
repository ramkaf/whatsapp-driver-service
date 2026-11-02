import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { WASocket } from 'baileys';
import type { WhatsappConnectService } from '../../connection/providers/wa-connect.service.ts';
import type { WhatsappGroupRepository } from './whatsapp-group.repository.ts';
import { WhatsappGroupService } from './whatsapp-group.service.ts';

function setup() {
  const socket = { groupLeave: vi.fn().mockResolvedValue(undefined) };
  const connection = { getSocket: vi.fn(() => socket as unknown as WASocket) };
  const repository = { exists: vi.fn().mockResolvedValue(true) };
  const service = new WhatsappGroupService(
    connection as unknown as WhatsappConnectService,
    repository as unknown as WhatsappGroupRepository,
  );
  return { socket, connection, repository, service };
}

describe('leave group validation', () => {
  it.each(['', '123@s.whatsapp.net', '123@lid', 'invalid@g.us', '123@g.us '])(
    'rejects invalid or non-group JIDs before calling WhatsApp: %s',
    async (jid) => {
      const { service, repository, socket } = setup();
      await expect(service.leave(jid)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repository.exists).not.toHaveBeenCalled();
      expect(socket.groupLeave).not.toHaveBeenCalled();
    },
  );

  it('returns 404 and does not leave when the group does not exist', async () => {
    const { service, repository, socket } = setup();
    repository.exists.mockResolvedValue(false);
    await expect(service.leave('123@g.us')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(socket.groupLeave).not.toHaveBeenCalled();
  });

  it.each(['123@g.us', '123-456@g.us'])(
    'leaves an existing group: %s',
    async (jid) => {
      const { service, repository, socket } = setup();
      await expect(service.leave(jid)).resolves.toEqual({
        groupJid: jid,
        left: true,
      });
      expect(repository.exists).toHaveBeenCalledWith(jid);
      expect(socket.groupLeave).toHaveBeenCalledWith(jid);
    },
  );

  it('keeps lookup failures distinct from a missing group', async () => {
    const { service, repository, socket } = setup();
    repository.exists.mockRejectedValueOnce(new Error('network failure'));
    await expect(service.leave('123@g.us')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    const disconnected = new ServiceUnavailableException(
      'WhatsApp is not connected',
    );
    repository.exists.mockRejectedValueOnce(disconnected);
    await expect(service.leave('123@g.us')).rejects.toBe(disconnected);
    expect(socket.groupLeave).not.toHaveBeenCalled();
  });
});
