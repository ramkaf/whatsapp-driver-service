import { ApiProperty } from '@nestjs/swagger';
import { CONNECTION_REASONS } from '../../connection/interfaces/connection-status.ts';
import { PairingMethodEnum } from '../interfaces/session.interface.ts';
import { WaSessionStatus } from '@database/enums.js';

export class RuntimeStatusDto {
  @ApiProperty({
    enum: WaSessionStatus,
    enumName: 'SessionStatus',
    example: 'CONNECTING',
  })
  status: string;
  @ApiProperty({
    example: false,
    description: 'True only when the current runtime socket is connected.',
  })
  connected: boolean;
  @ApiProperty({
    type: String,
    nullable: true,
    example: '989121234567',
    description:
      'Phone from the connected WASocket user identity; never read from the session record. Null when unavailable or disconnected.',
  })
  accountPhone: string | null;
  @ApiProperty({
    enum: CONNECTION_REASONS,
    nullable: true,
    description:
      'Current connection failure/recovery reason. Cleared after successful connection; not a raw error message.',
  })
  reason: CONNECTION_REASONS | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Last observed Baileys disconnect code; null when no code was received.',
  })
  lastDisconnectCode: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastDisconnectedAt: string | null;
  @ApiProperty({
    description:
      'Pairing is currently required. QR/code expiry alone does not mean a previously paired account was logged out.',
  })
  requiresPairing: boolean;
  @ApiProperty({ example: 0 }) retryCount: number;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
  })
  nextRetryAt: string | null;
  @ApiProperty({ example: 1 }) generation: number;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
  })
  lastActivityAt: string | null;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
  })
  connectedAt: string | null;
  @ApiProperty({
    example: 0,
    description: 'Current connection uptime in milliseconds.',
  })
  uptimeMs: number;
}

export class SessionResponseDto {
  @ApiProperty({ example: 'cmh1234560000sessionexample' }) id: string;
  @ApiProperty({ example: 'WhatsApp 01' }) name: string;
  @ApiProperty({ type: String, example: '989121234567' })
  phone: string;
  @ApiProperty({ enum: PairingMethodEnum, enumName: 'PairingMethod' })
  pairingMethod: string;
  @ApiProperty({
    example: true,
    description:
      'Controls automatic recovery. False after disconnect, logout or soft deletion; disabled sessions remain visible.',
  })
  isEnabled: boolean;
  @ApiProperty({
    enum: WaSessionStatus,
    enumName: 'SessionStatus',
    description:
      'Persisted status; inspect runtime.connected for current connectivity.',
  })
  status: string;
  @ApiProperty({ example: 0 }) retryCount: number;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
  })
  lastConnectedAt: string | null;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
  })
  lastDisconnectedAt: string | null;
  @ApiProperty({ type: Number, nullable: true, example: null })
  lastDisconnectCode: number | null;
  @ApiProperty({ type: String, nullable: true, example: null }) lastError:
    string | null;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
  })
  lastHeartbeatAt: string | null;
  @ApiProperty({ format: 'date-time', example: '2026-11-04T14:00:00.000Z' })
  createdAt: string;
  @ApiProperty({ format: 'date-time', example: '2026-11-04T14:00:00.000Z' })
  updatedAt: string;
  @ApiProperty({ type: () => RuntimeStatusDto }) runtime: RuntimeStatusDto;
}

export class PairingCodeResponseDto {
  @ApiProperty({ example: 'cmh1234560000sessionexample' }) sessionId: string;
  @ApiProperty({ enum: ['CODE'] }) pairingMethod: 'CODE';
  @ApiProperty({ enum: ['AWAITING_PAIRING'] }) status: 'AWAITING_PAIRING';
  @ApiProperty({
    example: 'ABCD1234',
    minLength: 8,
    maxLength: 8,
    description:
      'Eight-character WhatsApp pairing code. Enter it on the phone; do not log or share it.',
  })
  code: string;
  @ApiProperty({
    format: 'date-time',
    description:
      'Application validity bound, not a guarantee of WhatsApp acceptance.',
  })
  expiresAt: string;
}

export class QrResponseDto {
  @ApiProperty({ example: 'cmh1234560000sessionexample' }) sessionId: string;
  @ApiProperty({ enum: PairingMethodEnum, enumName: 'PairingMethod' })
  pairingMethod: string;
  @ApiProperty({ enum: WaSessionStatus, enumName: 'SessionStatus' })
  status: string;
  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description:
      'Raw QR payload, not an image. Null until ready or after expiry/authentication. Render locally in a trusted QR renderer.',
  })
  qr: string | null;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
  })
  expiresAt: string | null;
}

export class ApiErrorResponseDto {
  @ApiProperty({ example: 401 }) statusCode: number;
  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: 'Unauthorized',
  })
  message: string | string[];
}
