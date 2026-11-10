import { DisconnectReason } from '@whiskeysockets/baileys';
import {
  DisconnectAction,
  DisconnectInfo,
} from '../interfaces/connection-update.ts';
import { CONNECTION_REASONS } from '../interfaces/connection-status.ts';
import { DISCONNECT_RULES } from '../interfaces/disconnect-rules.ts';

interface ParsedDisconnectError {
  code: number | null;
  message: string | null;
}

export function parseDisconnectError(error: unknown): ParsedDisconnectError {
  if (!error || typeof error !== 'object') {
    return { code: null, message: null };
  }

  const output = 'output' in error ? error.output : null;

  const code =
    output && typeof output === 'object' && 'statusCode' in output
      ? output.statusCode
      : null;

  return {
    code: typeof code === 'number' && Number.isFinite(code) ? code : null,

    message:
      'message' in error && typeof error.message === 'string'
        ? error.message
        : null,
  };
}

export function classifyDisconnect(error: unknown): DisconnectInfo {
  const { code, message } = parseDisconnectError(error);

  // QR pairing attempts exhausted.
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
