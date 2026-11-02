import { createCipheriv, createHmac } from 'node:crypto';
import { proto } from 'baileys';
import type { WASocket, WAMessage } from 'baileys';
import { decryptEncryptedEdit } from './encrypted-edit.util.ts';
import { WhatsappMessageService } from '../core/providers/whatsapp-message.service.ts';
import { JsonlService } from '../core/providers/jsonl.service.ts';
import type { WhatsappMediaService } from '../core/providers/whatsapp-media.service.ts';

const secret = Buffer.alloc(32, 7);
const sender = '123456@lid';
const chatId = '123456@g.us';
const originalId = 'original-test-message';

function fixture(author = sender, targetId = originalId): WAMessage {
  const plaintext = proto.Message.encode({
    protocolMessage: {
      type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
      key: { id: targetId },
      editedMessage: { conversation: 'متن ویرایش‌شده' },
      timestampMs: 1793543572000,
    },
  }).finish();
  // Independent construction of the protocol's extract and expand steps.
  const extracted = createHmac('sha256', Buffer.alloc(32))
    .update(secret)
    .digest();
  const key = createHmac('sha256', extracted)
    .update(
      Buffer.concat([
        Buffer.from(originalId + author + author + 'Message Edit'),
        Buffer.from([1]),
      ]),
    )
    .digest();
  const iv = Buffer.alloc(12, 3);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    key: {
      remoteJid: chatId,
      participant: sender,
      fromMe: false,
      id: 'edit-envelope',
    },
    message: {
      secretEncryptedMessage: {
        secretEncType:
          proto.Message.SecretEncryptedMessage.SecretEncType.MESSAGE_EDIT,
        targetMessageKey: {
          remoteJid: chatId,
          id: originalId,
          fromMe: true,
          participant: sender,
        },
        encIv: iv,
        encPayload: ciphertext,
      },
    },
  };
}

function socket(): WASocket {
  return {
    ev: { emit: vi.fn() },
    signalRepository: {
      lidMapping: {
        getPNForLID: vi.fn().mockResolvedValue(null),
        getLIDForPN: vi.fn().mockResolvedValue(null),
      },
    },
  } as unknown as WASocket;
}

const original = {
  conversation: 'متن اولیه',
  messageContextInfo: { messageSecret: secret },
};

describe('encrypted message edits', () => {
  it('decrypts an incoming group edit with the original local key', async () => {
    const result = await decryptEncryptedEdit(socket(), fixture(), original);
    expect(result.key).toEqual({
      remoteJid: chatId,
      participant: sender,
      fromMe: false,
      id: originalId,
    });
    expect(result.update.message?.editedMessage?.message?.conversation).toBe(
      'متن ویرایش‌شده',
    );
    expect(result.update.messageTimestamp).toBe(1793543572);
  });

  it('uses a trusted PN alias when the ciphertext was created with PN addressing', async () => {
    const sock = socket();
    vi.spyOn(sock.signalRepository.lidMapping, 'getPNForLID').mockResolvedValue(
      '123456@s.whatsapp.net',
    );
    const result = await decryptEncryptedEdit(
      sock,
      fixture('123456@s.whatsapp.net'),
      original,
    );
    expect(result.update.message?.editedMessage).toBeDefined();
  });

  it('still decrypts with received addressing when alias lookup fails', async () => {
    const sock = socket();
    vi.spyOn(sock.signalRepository.lidMapping, 'getPNForLID').mockRejectedValue(
      new Error('unavailable'),
    );
    await expect(
      decryptEncryptedEdit(sock, fixture(), original),
    ).resolves.toBeDefined();
  });

  it('rejects missing originals, corrupt ciphertext and a mismatched decrypted target', async () => {
    await expect(
      decryptEncryptedEdit(socket(), fixture(), undefined),
    ).rejects.toThrow();
    const corrupt = fixture();
    corrupt.message!.secretEncryptedMessage!.encPayload![0] ^= 1;
    await expect(
      decryptEncryptedEdit(socket(), corrupt, original),
    ).rejects.toThrow();
    await expect(
      decryptEncryptedEdit(
        socket(),
        fixture(sender, 'different-target'),
        original,
      ),
    ).rejects.toThrow();
  });

  it('routes the encrypted upsert to messages.update without treating it as new media', async () => {
    const archive = new JsonlService();
    const save = vi.spyOn(archive, 'saveToFile').mockResolvedValue();
    const media = { save: vi.fn() };
    const service = new WhatsappMessageService(
      media as unknown as WhatsappMediaService,
      archive,
    );
    const sock = socket();
    const emit = vi.spyOn(sock.ev, 'emit');
    emit.mockImplementation((event, data) => {
      if (event === 'messages.update') {
        void service.handleUpdate(
          sock,
          data as Parameters<typeof service.handleUpdate>[1],
        );
      }
      return true;
    });
    archive.remember({
      key: {
        remoteJid: chatId,
        participant: sender,
        fromMe: false,
        id: originalId,
      },
      message: original,
    });
    await service.handleUpsert(sock, [fixture()]);
    expect(emit).toHaveBeenCalledWith('messages.update', [
      expect.objectContaining({
        key: expect.objectContaining({ id: originalId }),
      }),
    ]);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'message.edited',
        messageId: originalId,
      }),
    );
    expect(media.save).not.toHaveBeenCalled();
  });
});
