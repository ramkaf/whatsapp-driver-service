import { DisconnectAction } from '../../interfaces/connection-update.ts';
import { Injectable } from '@nestjs/common';
import { DisconnectReason } from '@whiskeysockets/baileys';
import { CONNECTION_REASONS } from '../../interfaces/connection-status.ts';
import type { DisconnectInfo } from '../../interfaces/connection-update.ts';

// Classifies disconnect errors without inferring their underlying account or network cause.
@Injectable()
export class DisconnectClassifierService {
  classify(error: unknown): DisconnectInfo {
    const code = this.statusCode(error);
    const errorMessage = this.extractErrorMessage(error);
    if (
      code === DisconnectReason.timedOut &&
      errorMessage === 'QR refs attempts ended'
    ) {
      return {
        code,
        action: DisconnectAction.EXPIRED,
        reason: CONNECTION_REASONS.QR_EXPIRED,
      };
    }
    switch (code) {
      case DisconnectReason.loggedOut:
        return {
          code,
          action: DisconnectAction.LOGOUT,
          reason: CONNECTION_REASONS.LOGGED_OUT,
        };
      case DisconnectReason.connectionReplaced:
        return {
          code,
          action: DisconnectAction.REPLACED,
          reason: CONNECTION_REASONS.CONNECTION_REPLACED,
        };
      case DisconnectReason.badSession:
        return {
          code,
          action: DisconnectAction.INVALID,
          reason: CONNECTION_REASONS.INVALID_SESSION,
        };
      case DisconnectReason.multideviceMismatch:
        return {
          code,
          action: DisconnectAction.INVALID,
          reason: CONNECTION_REASONS.MULTIDEVICE_MISMATCH,
        };
      case DisconnectReason.forbidden:
        return {
          code,
          action: DisconnectAction.INVALID,
          reason: CONNECTION_REASONS.FORBIDDEN,
        };
      case DisconnectReason.restartRequired:
        return {
          code,
          action: DisconnectAction.RESTART,
          reason: CONNECTION_REASONS.RESTART_REQUIRED,
        };
      case DisconnectReason.connectionClosed:
        return {
          code,
          action: DisconnectAction.RETRY,
          reason: CONNECTION_REASONS.SOCKET_CLOSED,
        };
      case DisconnectReason.connectionLost:
        // Baileys uses 408 for both connectionLost and timedOut.
        return {
          code,
          action: DisconnectAction.RETRY,
          reason: CONNECTION_REASONS.TIMEOUT_OR_CONNECTION_LOST,
        };
      case DisconnectReason.unavailableService:
        return {
          code,
          action: DisconnectAction.RETRY,
          reason: CONNECTION_REASONS.SERVICE_UNAVAILABLE,
        };
      default:
        return {
          code,
          action: DisconnectAction.RETRY,
          reason: CONNECTION_REASONS.UNKNOWN_CLOSE,
        };
    }
  }

  private statusCode(error: unknown): number | null {
    if (!error || typeof error !== 'object' || !('output' in error))
      return null;
    const output = error.output;
    if (!output || typeof output !== 'object' || !('statusCode' in output))
      return null;
    return typeof output.statusCode === 'number' &&
      Number.isFinite(output.statusCode)
      ? output.statusCode
      : null;
  }

  extractErrorMessage(error: unknown): string | null {
    return error && typeof error === 'object' && 'message' in error
      ? (error.message as string)
      : null;
  }
}
