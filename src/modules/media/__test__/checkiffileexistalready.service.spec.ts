import { MinioStorageService } from '../providers/minio-storage.service.ts';
import type { MinioObjectInfo } from '../interfaces/media.interface.ts';
import type { IAppConfig } from '@libs/common';

const conversationId = 'chat@s.whatsapp.net';
const prefix = `conversations/${conversationId}/`;
const filename = (id: string) =>
  `2026-11-09T12-00-00-000Z_0a9f3bd5-c57d-4926-a1a7-d0c8022152c3_${id}.jpg`;
const object = (id = 'message-one', size = 20): MinioObjectInfo => ({
  objectKey: prefix + filename(id),
  size,
  etag: 'list-etag',
});

function fixture(objects: MinioObjectInfo[] = []) {
  const storage = Object.assign(
    new MinioStorageService({
      minio: {
        endpoint: 'storage.test',
        port: 9000,
        useSsl: false,
        accessKey: 'test-access',
        secretKey: 'test-secret',
        bucket: 'test-media',
      },
    } as IAppConfig),
    {
      listObjects: vi.fn(async function* (_prefix: string) {
        yield* objects;
      }),
      getObjectInfo: vi.fn(
        async (key: string) =>
          objects.find((entry) => entry.objectKey === key) ?? null,
      ),
      getStoredObject: vi.fn(async (key: string, etag: string) => ({
        bucket: 'test-media',
        objectKey: key,
        etag,
        url: `https://storage.test/test-media/${key}?signature=fresh`,
        urlExpiresAt: '2026-11-16T12:00:00.000Z',
      })),
    },
  );
  return { storage };
}

describe('MinioStorageService.exists', () => {
  it('confirms the size and current etag and returns a fresh URL for the existing object', async () => {
    const candidate = object();
    const { storage } = fixture([candidate]);
    storage.getObjectInfo.mockResolvedValueOnce({
      ...candidate,
      etag: 'current-etag',
    });
    const result = await storage.exists(conversationId, 'message-one', 20);
    expect(storage.listObjects).toHaveBeenCalledExactlyOnceWith(prefix);
    expect(storage.getObjectInfo).toHaveBeenCalledExactlyOnceWith(
      candidate.objectKey,
    );
    expect(storage.getStoredObject).toHaveBeenCalledExactlyOnceWith(
      candidate.objectKey,
      'current-etag',
    );
    expect(result).toMatchObject({
      objectKey: candidate.objectKey,
      url: expect.stringContaining('signature=fresh'),
    });
  });

  it('does not match another conversation, nested folders, partial IDs or a different size', async () => {
    const candidates = [
      {
        ...object(),
        objectKey: `conversations/other@s.whatsapp.net/${filename('message-one')}`,
      },
      { ...object(), objectKey: `${prefix}nested/${filename('message-one')}` },
      object('message-one-more'),
      object('another_message-one'),
      object('message-one', 21),
    ];
    const { storage } = fixture(candidates);
    await expect(
      storage.exists(conversationId, 'message-one', 20),
    ).resolves.toBeNull();
    expect(storage.getObjectInfo).not.toHaveBeenCalled();
    expect(storage.getStoredObject).not.toHaveBeenCalled();
  });

  it('preserves underscores and dots when matching the full message ID', async () => {
    const candidate = object('message_one.part');
    const { storage } = fixture([candidate]);
    await expect(
      storage.exists(conversationId, 'message_one.part', 20),
    ).resolves.toMatchObject({ objectKey: candidate.objectKey });
  });

  it('sanitizes conversation and message IDs the same way as the saved path', async () => {
    const candidate = {
      ...object('message_one'),
      objectKey: `conversations/chat_one/${filename('message_one')}`,
    };
    const { storage } = fixture([candidate]);
    await expect(
      storage.exists('chat/one', 'message/one', 20),
    ).resolves.toMatchObject({ objectKey: candidate.objectKey });
    expect(storage.listObjects).toHaveBeenCalledWith('conversations/chat_one/');
  });

  it('continues searching if listed objects disappeared or their sizes changed', async () => {
    const candidates = [0, 1, 2].map((index) => ({
      ...object(),
      objectKey:
        prefix + filename('message-one').replace('000Z', `00${index}Z`),
    }));
    const { storage } = fixture(candidates);
    storage.getObjectInfo
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...candidates[1]!, size: 99 });
    await expect(
      storage.exists(conversationId, 'message-one', 20),
    ).resolves.toMatchObject({ objectKey: candidates[2]!.objectKey });
    expect(storage.getStoredObject).toHaveBeenCalledOnce();
  });

  it('supports an empty file and an empty conversation listing', async () => {
    const { storage } = fixture([object('empty', 0)]);
    await expect(
      storage.exists(conversationId, 'empty', 0),
    ).resolves.toMatchObject({ objectKey: prefix + filename('empty') });
    await expect(
      fixture().storage.exists(conversationId, 'missing', 20),
    ).resolves.toBeNull();
  });

  it('propagates listing and metadata failures instead of claiming the file is absent', async () => {
    const { storage } = fixture([object()]);
    const failure = new Error('MinIO unavailable');
    storage.listObjects.mockImplementationOnce(async function* () {
      await Promise.reject(failure);
      yield object();
    });
    await expect(
      storage.exists(conversationId, 'message-one', 20),
    ).rejects.toBe(failure);
    storage.getObjectInfo.mockRejectedValueOnce(failure);
    await expect(
      storage.exists(conversationId, 'message-one', 20),
    ).rejects.toBe(failure);
    expect(storage.getStoredObject).not.toHaveBeenCalled();
  });
});
