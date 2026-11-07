import { Injectable } from '@nestjs/common';
import { DisconnectReason } from '@whiskeysockets/baileys';
import type { ConnectionState } from '@whiskeysockets/baileys';

export type DisconnectAction =
  'retry' | 'restart' | 'logout' | 'replaced' | 'expired' | 'invalid';

@Injectable()
export class ConnectionHandlerService {
  process(update: Partial<ConnectionState>) {
    return {
      qr: update.qr,
      authenticating: update.isNewLogin === true,
      connection: update.connection,
      disconnect: update.connection === 'close' ? this.classify(update) : null,
    };
  }

  classify(update: Partial<ConnectionState>): {
    code: number | null;
    action: DisconnectAction;
  } {
    const error = update.lastDisconnect?.error;
    const code =
      error && 'output' in error
        ? ((error as { output?: { statusCode?: number } }).output?.statusCode ??
          null)
        : null;
    if (
      code === DisconnectReason.timedOut &&
      error?.message === 'QR refs attempts ended'
    ) {
      return { code, action: 'expired' };
    }
    switch (code) {
      case DisconnectReason.loggedOut:
        return { code, action: 'logout' };
      case DisconnectReason.connectionReplaced:
        return { code, action: 'replaced' };
      case DisconnectReason.badSession:
      case DisconnectReason.multideviceMismatch:
      case DisconnectReason.forbidden:
        return { code, action: 'invalid' };
      case DisconnectReason.restartRequired:
        return { code, action: 'restart' };
      default:
        return { code, action: 'retry' };
    }
  }
}
