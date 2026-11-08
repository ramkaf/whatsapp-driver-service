import type { ConnectionState } from '@whiskeysockets/baileys';
import type { CONNECTION_REASONS } from './connection-status.ts';

export enum DisconnectAction {
  RETRY = 'retry',
  RESTART = 'restart',
  LOGOUT = 'logout',
  REPLACED = 'replaced',
  EXPIRED = 'expired',
  INVALID = 'invalid',
}
export interface DisconnectInfo {
  code: number | null;
  action: DisconnectAction;
  reason: CONNECTION_REASONS;
}
export interface DisconnectRule {
  code: number;
  action: DisconnectAction;
  reason: CONNECTION_REASONS;
}
export interface ProcessedConnectionUpdate {
  qr?: string;
  authenticating: boolean;
  connection?: ConnectionState['connection'];
  disconnect: DisconnectInfo | null;
}

