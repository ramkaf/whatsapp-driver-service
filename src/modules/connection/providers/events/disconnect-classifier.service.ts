
import { Injectable } from '@nestjs/common';
import { DisconnectReason } from '@whiskeysockets/baileys';
import {
  CONNECTION_REASONS,
} from '../../interfaces/connection-status.ts';
import {
  DisconnectInfo,
  DisconnectAction
} from "../../interfaces/connection-update.js";
import { DisconnectErrorParser } from './disconnect-error.parser.ts';
import { DISCONNECT_RULES } from './disconnect-rules.ts';

@Injectable()
export class DisconnectClassifierService {
  private readonly parser = new DisconnectErrorParser();

  classify(error: unknown): DisconnectInfo {
    const parsed = this.parser.parse(error);

    if (
      parsed.code === DisconnectReason.timedOut &&
      parsed.message === 'QR refs attempts ended'
    ) {
      return {
        code: parsed.code,
        action: DisconnectAction.EXPIRED,
        reason: CONNECTION_REASONS.QR_EXPIRED,
      };
    }

    const rule = DISCONNECT_RULES.find(
      (item) => item.code === parsed.code,
    );

    if (rule) {
      return {
        code: parsed.code,
        action: rule.action,
        reason: rule.reason,
      };
    }

    return {
      code: parsed.code,
      action: DisconnectAction.RETRY,
      reason: CONNECTION_REASONS.UNKNOWN_CLOSE,
    };
  }
}
