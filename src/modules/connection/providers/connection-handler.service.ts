import { Injectable } from '@nestjs/common';
import { DisconnectReason } from '@whiskeysockets/baileys';
import type { ConnectionState } from '@whiskeysockets/baileys';
import { CONNECTION_REASONS } from '../interfaces/connection-status.ts';

export type DisconnectAction =
  'retry' | 'restart' | 'logout' | 'replaced' | 'expired' | 'invalid';

// رویدادهای اتصال واتساپ را تفسیر و علت قطع و اقدام مناسب برای آن را دسته‌بندی می‌کند.
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
    reason: CONNECTION_REASONS;
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
      return { code, action: 'expired', reason: CONNECTION_REASONS.QR_EXPIRED };
    }
    switch (code) {
      case DisconnectReason.loggedOut:
        return {
          code,
          action: 'logout',
          reason: CONNECTION_REASONS.LOGGED_OUT,
        };
      case DisconnectReason.connectionReplaced:
        return {
          code,
          action: 'replaced',
          reason: CONNECTION_REASONS.CONNECTION_REPLACED,
        };
      case DisconnectReason.badSession:
        return {
          code,
          action: 'invalid',
          reason: CONNECTION_REASONS.INVALID_SESSION,
        };
      case DisconnectReason.multideviceMismatch:
        return {
          code,
          action: 'invalid',
          reason: CONNECTION_REASONS.MULTIDEVICE_MISMATCH,
        };
      case DisconnectReason.forbidden:
        return {
          code,
          action: 'invalid',
          reason: CONNECTION_REASONS.FORBIDDEN,
        };
      case DisconnectReason.restartRequired:
        return {
          code,
          action: 'restart',
          reason: CONNECTION_REASONS.RESTART_REQUIRED,
        };
      case DisconnectReason.connectionClosed:
        return {
          code,
          action: 'retry',
          reason: CONNECTION_REASONS.SOCKET_CLOSED,
        };
      case DisconnectReason.connectionLost:
        // Baileys uses 408 for both connectionLost and timedOut.
        return {
          code,
          action: 'retry',
          reason: CONNECTION_REASONS.TIMEOUT_OR_CONNECTION_LOST,
        };
      case DisconnectReason.unavailableService:
        return {
          code,
          action: 'retry',
          reason: CONNECTION_REASONS.SERVICE_UNAVAILABLE,
        };
      default:
        return {
          code,
          action: 'retry',
          reason: CONNECTION_REASONS.UNKNOWN_CLOSE,
        };
    }
  }
}
