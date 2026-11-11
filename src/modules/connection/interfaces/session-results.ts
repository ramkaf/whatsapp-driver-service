import type { WaSessionStatus } from '@database/client.js';
import type { CONNECTION_REASONS } from './connection-status.ts';

export interface PairingSecret {
  value: string;
  expiresAt: number;
}
export interface PairingCode {
  code: string;
  expiresAt: string;
}
export interface PairingQr {
  qr: string | null;
  expiresAt: string | null;
}
export interface ConnectionStatus {
  connected: boolean;
  status: WaSessionStatus;
  accountPhone: string | null;
  generation: number;
  retryCount: number;
  nextRetryAt: string | null;
  reason: CONNECTION_REASONS | null;
  lastDisconnectCode: number | null;
  lastDisconnectedAt: string | null;
  requiresPairing: boolean;
}
export interface SessionSnapshot extends ConnectionStatus {
  lastActivityAt: string | null;
  connectedAt: string | null;
  uptimeMs: number;
}
export interface ConnectionStatusSource {
  exists(sessionId: string): Promise<void>;
  snapshot(sessionId: string): ConnectionStatus;
}
