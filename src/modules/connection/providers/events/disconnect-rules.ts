
import { DisconnectReason } from '@whiskeysockets/baileys';
import {
  CONNECTION_REASONS,
} from '../../interfaces/connection-status.ts';
import { DisconnectAction, DisconnectRule } from '../../interfaces/connection-update.ts';

export const DISCONNECT_RULES: readonly DisconnectRule[] = [
  {
    code: DisconnectReason.loggedOut,
    action: DisconnectAction.LOGOUT,
    reason: CONNECTION_REASONS.LOGGED_OUT,
  },
  {
    code: DisconnectReason.connectionReplaced,
    action: DisconnectAction.REPLACED,
    reason: CONNECTION_REASONS.CONNECTION_REPLACED,
  },
  {
    code: DisconnectReason.badSession,
    action: DisconnectAction.INVALID,
    reason: CONNECTION_REASONS.INVALID_SESSION,
  },
  {
    code: DisconnectReason.multideviceMismatch,
    action: DisconnectAction.INVALID,
    reason: CONNECTION_REASONS.MULTIDEVICE_MISMATCH,
  },
  {
    code: DisconnectReason.forbidden,
    action: DisconnectAction.INVALID,
    reason: CONNECTION_REASONS.FORBIDDEN,
  },
  {
    code: DisconnectReason.restartRequired,
    action: DisconnectAction.RESTART,
    reason: CONNECTION_REASONS.RESTART_REQUIRED,
  },
  {
    code: DisconnectReason.connectionClosed,
    action: DisconnectAction.RETRY,
    reason: CONNECTION_REASONS.SOCKET_CLOSED,
  },
  {
    code: DisconnectReason.connectionLost,
    action: DisconnectAction.RETRY,
    reason: CONNECTION_REASONS.TIMEOUT_OR_CONNECTION_LOST,
  },
  {
    code: DisconnectReason.timedOut,
    action: DisconnectAction.RETRY,
    reason: CONNECTION_REASONS.TIMEOUT_OR_CONNECTION_LOST,
  },
  {
    code: DisconnectReason.unavailableService,
    action: DisconnectAction.RETRY,
    reason: CONNECTION_REASONS.SERVICE_UNAVAILABLE,
  },
];
