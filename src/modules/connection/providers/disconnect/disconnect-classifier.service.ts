import { DisconnectAction } from '../../interfaces/connection-update.ts';
import { Injectable } from '@nestjs/common';
import { DisconnectReason } from '@whiskeysockets/baileys';
import { CONNECTION_REASONS } from '../../interfaces/connection-status.ts';
import type { DisconnectInfo } from '../../interfaces/connection-update.ts';
import { DisconnectErrorParser } from './disconnect-error.parser.ts';
import { DISCONNECT_RULES } from './disconnect-rules.ts';

// Classifies disconnect errors without inferring their underlying account or network cause.
@Injectable()
export class DisconnectClassifierService {
  private readonly parser = new DisconnectErrorParser();

  classify(error: unknown): DisconnectInfo {
    const { code, message } = this.parser.parse(error);

    // An exhausted QR attempt shares its code with ordinary network timeouts.
    if (
      code === DisconnectReason.timedOut &&
      message === 'QR refs attempts ended'
    ) {
      return {
        code,
        action: DisconnectAction.EXPIRED,
        reason: CONNECTION_REASONS.QR_EXPIRED,
      };
    }
    const rule = DISCONNECT_RULES.find((item) => item.code === code);

    return {
      code,
      action: rule?.action ?? DisconnectAction.RETRY,
      reason: rule?.reason ?? CONNECTION_REASONS.UNKNOWN_CLOSE,
    };
  }
}
