import type { PairingSecret } from './session-results.ts';
import type { WASocket } from '@whiskeysockets/baileys';
import type { WaSessionStatus } from '@database/client.js';
import type { AuthContext } from '../../auth-state/context/auth-state.context.ts';
import type { CONNECTION_REASONS } from './connection-status.ts';
import { PairingMethodEnum } from '../../sessions/interfaces/session.interface.ts';

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
  pairingMethod: PairingMethodEnum;
  lastActivityAt: number;
  connectedAt: number | null;
  stateSince: number;
  stable: boolean;
  intentionalStop: boolean;
  pairingReady: boolean;
  qr: PairingSecret | null;
  code: PairingSecret | null;
  lastCodeRequestAt: number;
  dispose: (() => void) | null;
}
