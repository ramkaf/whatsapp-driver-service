
import { Injectable } from '@nestjs/common';

import {
  initAuthCreds,
  type AuthenticationState,
} from '@whiskeysockets/baileys';

import {
  PrismaService,
} from '@libs/prisma';

import { AuthStateQueue } from '../infrastructure/auth-state.queue.ts';
import { AuthStateContext, AuthContext } from '../context/auth-state.context.ts';
import { AuthStateSerializer } from '../repository/auth-state.serializer.ts';

@Injectable()
export class AuthStateService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async hasIdentity(sessionId: string): Promise<boolean> {
    const stored = await this.loadCredentials(sessionId);

    if (!stored) {
      return false;
    }

    const creds = AuthStateSerializer.decode<
      AuthenticationState['creds']
    >(stored.creds);

    return Boolean(creds.me?.id);
  }

  async open(
    sessionId: string,
    onFailure: (error: unknown) => void,
  ): Promise<AuthContext> {
    const stored = await this.loadCredentials(sessionId);

    const creds = stored
      ? AuthStateSerializer.decode<
          AuthenticationState['creds']
        >(stored.creds)
      : initAuthCreds();

    const queue = new AuthStateQueue(onFailure);

    const context = new AuthStateContext(
      this.prisma,
      sessionId,
      queue,
      creds,
    );

    // Persist initial credentials for a new session.
    if (!stored) {
      await context.saveCreds();
    }

    return context;
  }

  async clear(sessionId: string): Promise<void> {
    // The manager must fence and drain the session
    // before calling this method.
    await this.prisma.$transaction([
      this.prisma.waAuthKey.deleteMany({
        where: { sessionId },
      }),
      this.prisma.waAuthCreds.deleteMany({
        where: { sessionId },
      }),
    ]);
  }

  private async loadCredentials(sessionId: string) {
    return this.prisma.waAuthCreds.findUnique({
      where: { sessionId },
    });
  }
}
