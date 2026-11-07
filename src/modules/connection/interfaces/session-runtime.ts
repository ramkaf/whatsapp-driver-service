import type { WASocket } from '@whiskeysockets/baileys';
import type { WaSessionStatus, WaPairingMethod } from '@libs/prisma';
import type { AuthContext } from '../../auth-state/providers/auth-state.service.ts';
import type { CONNECTION_REASONS } from './connection-status.ts';

export interface SessionRuntime {
  sessionId: string;
  socket: WASocket | null;
  auth: AuthContext | null;
  retryCount: number;
  reconnectTimer: NodeJS.Timeout | null;
  nextRetryAt: number | null;
  generation: number;
  status: WaSessionStatus;
  reason: CONNECTION_REASONS | null;
  lastDisconnectCode: number | null;
  lastDisconnectedAt: number | null;
  pairingMethod: WaPairingMethod;
  lastActivityAt: number;
  connectedAt: number | null;
  stateSince: number;
  stable: boolean;
  intentionalStop: boolean;
  pairingReady: boolean;
  qr: { value: string; expiresAt: number } | null;
  code: { value: string; expiresAt: number } | null;
  lastCodeRequestAt: number;
  dispose: (() => void) | null;
}
