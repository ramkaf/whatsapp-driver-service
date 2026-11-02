import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeWASocket } from 'baileys';
import type { JsonlService } from '../../messages/core/providers/jsonl.service.ts';
import { WhatsappSocketFactory } from './wa-socket.factory.ts';

vi.mock('baileys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('baileys')>()),
  makeWASocket: vi.fn(() => ({})),
}));

describe('auth session archives', () => {
  let temporaryDirectory: string;
  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'wa-reset-test-'));
    vi.stubEnv('WHATSAPP_AUTH_DIR', join(temporaryDirectory, 'auth'));
    vi.mocked(makeWASocket).mockClear();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('preserves old credentials, drains key writes and blocks stale callbacks after reset', async () => {
    const factory = new WhatsappSocketFactory({
      getMessage: vi.fn(),
    } as unknown as JsonlService);
    const first = await factory.create();
    await first.saveCreds();
    const authDir = join(temporaryDirectory, 'auth');
    const oldCredentials = await readFile(join(authDir, 'creds.json'), 'utf8');
    const firstAuth = vi.mocked(makeWASocket).mock.calls[0][0].auth!;
    const keys = firstAuth.keys.set({
      session: { test: Buffer.from('old-session') },
    });
    await factory.archiveSession();
    await keys;
    const archive = (await readdir(temporaryDirectory)).find((name) =>
      name.startsWith('auth.archive-'),
    )!;
    expect(
      await readFile(join(temporaryDirectory, archive, 'creds.json'), 'utf8'),
    ).toBe(oldCredentials);
    expect(
      await stat(join(temporaryDirectory, archive, 'session-test.json')),
    ).toBeDefined();
    expect((await stat(join(temporaryDirectory, archive))).mode & 0o777).toBe(
      0o700,
    );
    await expect(stat(authDir)).rejects.toMatchObject({ code: 'ENOENT' });

    const second = await factory.create();
    expect(second.hasSavedSession).toBe(false);
    await second.saveCreds();
    const newCredentials = await readFile(join(authDir, 'creds.json'), 'utf8');
    expect(newCredentials).not.toBe(oldCredentials);
    await first.saveCreds();
    await firstAuth.keys.set({ session: { stale: Buffer.from('stale') } });
    expect(await readFile(join(authDir, 'creds.json'), 'utf8')).toBe(
      newCredentials,
    );
    await expect(
      stat(join(authDir, 'session-stale.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(
      vi.mocked(makeWASocket).mock.calls[1][0].shouldSyncHistoryMessage,
    ).toBeUndefined();
    expect(vi.mocked(makeWASocket).mock.calls[1][0].syncFullHistory).toBe(
      false,
    );
  });

  it('allows reset before any session has been created', async () => {
    const factory = new WhatsappSocketFactory({} as JsonlService);
    await expect(factory.archiveSession()).resolves.toBeUndefined();
  });

  it('rejects an auth directory that contains the application', async () => {
    vi.stubEnv('WHATSAPP_AUTH_DIR', process.cwd());
    const factory = new WhatsappSocketFactory({} as JsonlService);
    await expect(factory.archiveSession()).rejects.toThrow('must not contain');
  });
});
