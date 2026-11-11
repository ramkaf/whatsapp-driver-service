import { Global, Module } from '@nestjs/common';
import { INBOX_REPOSITORY } from './inbox/inbox.repository.interface.ts';
import { InboxRepository } from './inbox/inbox.repository.ts';
import { WA_SESSION_REPOSITORY } from './wa-session/wa-session.repository.interface.ts';
import { WaSessionRepository } from './wa-session/wa-session.repository.ts';
import { WA_AUTH_CREDS_REPOSITORY } from './wa-auth-creds/wa-auth-creds.repository.interface.ts';
import { WaAuthCredsRepository } from './wa-auth-creds/wa-auth-creds.repository.ts';
import { WA_AUTH_KEY_REPOSITORY } from './wa-auth-key/wa-auth-key.repository.interface.ts';
import { WaAuthKeyRepository } from './wa-auth-key/wa-auth-key.repository.ts';
import { WA_SESSION_EVENT_REPOSITORY } from './wa-session-event/wa-session-event.repository.interface.ts';
import { WaSessionEventRepository } from './wa-session-event/wa-session-event.repository.ts';
import { OUTBOX_REPOSITORY } from './outbox/outbox.repository.interface.ts';
import { OutboxRepository } from './outbox/outbox.repository.ts';

@Global()
@Module({
  imports: [],
  providers: [
    InboxRepository,
    { provide: INBOX_REPOSITORY, useExisting: InboxRepository },
    WaSessionRepository,
    { provide: WA_SESSION_REPOSITORY, useExisting: WaSessionRepository },
    WaAuthCredsRepository,
    { provide: WA_AUTH_CREDS_REPOSITORY, useExisting: WaAuthCredsRepository },
    WaAuthKeyRepository,
    { provide: WA_AUTH_KEY_REPOSITORY, useExisting: WaAuthKeyRepository },
    WaSessionEventRepository,
    {
      provide: WA_SESSION_EVENT_REPOSITORY,
      useExisting: WaSessionEventRepository,
    },
    OutboxRepository,
    { provide: OUTBOX_REPOSITORY, useExisting: OutboxRepository },
  ],
  exports: [
    INBOX_REPOSITORY,
    InboxRepository,
    WA_SESSION_REPOSITORY,
    WaSessionRepository,
    WA_AUTH_CREDS_REPOSITORY,
    WaAuthCredsRepository,
    WA_AUTH_KEY_REPOSITORY,
    WaAuthKeyRepository,
    WA_SESSION_EVENT_REPOSITORY,
    WaSessionEventRepository,
    OUTBOX_REPOSITORY,
    OutboxRepository,
  ],
})
export class RepositoriesModule {}
