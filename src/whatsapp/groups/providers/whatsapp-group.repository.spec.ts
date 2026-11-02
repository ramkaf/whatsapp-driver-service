import { ServiceUnavailableException } from '@nestjs/common';
import type { GroupMetadata, WASocket } from 'baileys';
import type { WhatsappConnectService } from '../../connection/providers/wa-connect.service.ts';
import { WhatsappGroupRepository } from './whatsapp-group.repository.ts';

const group: GroupMetadata = {
  id: '123@g.us',
  subject: 'Test group',
  owner: undefined,
  participants: [
    { id: '111@lid', phoneNumber: '222@s.whatsapp.net', admin: 'admin' },
    { id: '333@s.whatsapp.net', lid: '444@lid', admin: 'superadmin' },
    { id: '555@lid', admin: null },
  ],
};

function setup() {
  const socket = {
    groupMetadata: vi.fn().mockResolvedValue(group),
    groupFetchAllParticipating: vi
      .fn()
      .mockResolvedValue({ [group.id]: group }),
  };
  const connection = { getSocket: vi.fn(() => socket as unknown as WASocket) };
  const repository = new WhatsappGroupRepository(
    connection as unknown as WhatsappConnectService,
  );
  return { socket, connection, repository };
}

describe('WhatsappGroupRepository', () => {
  it('returns raw metadata for one group and an array of joined groups', async () => {
    const { repository, socket } = setup();
    expect(await repository.findOne(group.id)).toBe(group);
    expect(socket.groupMetadata).toHaveBeenCalledWith(group.id);
    expect(await repository.findAll()).toEqual([group]);
  });

  it('distinguishes a missing group from upstream or connection errors', async () => {
    const { repository, socket, connection } = setup();
    expect(await repository.exists(group.id)).toBe(true);
    socket.groupMetadata.mockRejectedValueOnce({ output: { statusCode: 404 } });
    expect(await repository.exists(group.id)).toBe(false);
    const forbidden = { output: { statusCode: 403 } };
    socket.groupMetadata.mockRejectedValueOnce(forbidden);
    await expect(repository.exists(group.id)).rejects.toBe(forbidden);
    const disconnected = new ServiceUnavailableException();
    connection.getSocket.mockImplementationOnce(() => {
      throw disconnected;
    });
    await expect(repository.exists(group.id)).rejects.toBe(disconnected);
    socket.groupMetadata.mockRejectedValueOnce(new Error('network failed'));
    await expect(repository.exists(group.id)).rejects.toThrow('network failed');
  });

  it.each([
    '111@lid',
    '222@s.whatsapp.net',
    '222:7@s.whatsapp.net',
    '333@s.whatsapp.net',
    '444@lid',
  ])(
    'recognizes admins and superadmins through their JID aliases: %s',
    async (userJid) => {
      const { repository } = setup();
      expect(await repository.isUserAdmin(group.id, userJid)).toBe(true);
    },
  );

  it.each(['555@lid', '999@lid', ''])(
    'does not grant admin status to ordinary or missing members: %s',
    async (userJid) => {
      const { repository } = setup();
      expect(await repository.isUserAdmin(group.id, userJid)).toBe(false);
    },
  );

  it('propagates metadata errors from admin checks', async () => {
    const { repository, socket } = setup();
    socket.groupMetadata.mockRejectedValueOnce(new Error('unavailable'));
    await expect(repository.isUserAdmin(group.id, '111@lid')).rejects.toThrow(
      'unavailable',
    );
  });
});
