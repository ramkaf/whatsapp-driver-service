
import {
  type AuthenticationState,
} from '@whiskeysockets/baileys';

import { PrismaService } from '@libs/prisma';

import { AuthStateQueue } from '../infrastructure/auth-state.queue.ts';
import { AuthStateKeyStore } from '../repository/auth-state.key-store.ts';
import { AuthStateSerializer } from '../repository/auth-state.serializer.ts';

export interface AuthContext {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  flush: () => Promise<void>;
  close: () => Promise<void>;
}

export class AuthStateContext implements AuthContext {
  readonly state: AuthenticationState;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionId: string,
    private readonly queue: AuthStateQueue,
    creds: AuthenticationState['creds'],
  ) {
    this.state = {
      creds,
      keys: new AuthStateKeyStore(
        prisma,
        sessionId,
        queue,
      ),
    };
  }

  saveCreds = (): Promise<void> => {
    // Capture a snapshot before queue execution.
    const snapshot = AuthStateSerializer.encode(
      this.state.creds,
    );

    return this.queue.run(async () => {
      await this.prisma.waAuthCreds.upsert({
        where: {
          sessionId: this.sessionId,
        },
        create: {
          sessionId: this.sessionId,
          creds: snapshot,
        },
        update: {
          creds: snapshot,
        },
      });
    });
  };

  flush = async (): Promise<void> => {
    await this.queue.flush();
  };

  close = async (): Promise<void> => {
    await this.queue.close();
  };
}
