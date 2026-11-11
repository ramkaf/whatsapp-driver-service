import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import {
  INBOX_REPOSITORY,
  InboxRepository,
  OUTBOX_REPOSITORY,
  OutboxRepository,
  PrismaModule,
  PrismaService,
  WA_AUTH_CREDS_REPOSITORY,
  WaAuthCredsRepository,
  WA_AUTH_KEY_REPOSITORY,
  WaAuthKeyRepository,
  WA_SESSION_REPOSITORY,
  WaSessionRepository,
  WA_SESSION_EVENT_REPOSITORY,
  WaSessionEventRepository,
} from '@libs/prisma';

describe('RepositoriesModule', () => {
  it('resolves every repository token to its registered instance through PrismaModule', async () => {
    const module = await Test.createTestingModule({
      imports: [PrismaModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    try {
      const registrations = [
        [INBOX_REPOSITORY, InboxRepository],
        [OUTBOX_REPOSITORY, OutboxRepository],
        [WA_AUTH_CREDS_REPOSITORY, WaAuthCredsRepository],
        [WA_AUTH_KEY_REPOSITORY, WaAuthKeyRepository],
        [WA_SESSION_REPOSITORY, WaSessionRepository],
        [WA_SESSION_EVENT_REPOSITORY, WaSessionEventRepository],
      ] as const;

      for (const [token, implementation] of registrations) {
        const repository = module.get(token);
        expect(repository).toBeInstanceOf(implementation);
        expect(repository).toBe(module.get(implementation));
      }
    } finally {
      await module.close();
    }
  });
});
