import { ApiProperty } from '@nestjs/swagger';
import { WaPairingMethod, WaSessionStatus } from '@libs/prisma';

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
  @ApiProperty({ type: String, nullable: true, example: '989121234567' })
  phone: string | null;
  @ApiProperty({ enum: WaPairingMethod, enumName: 'PairingMethod' })
  pairingMethod: string;
  @ApiProperty({
    example: true,
    description: 'Controls automatic recovery after process restart.',
  })
  enabled: boolean;
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
  @ApiProperty({ type: String, nullable: true, example: null }) instanceId:
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
    description: 'Login secret. Enter it on the phone; do not log or share it.',
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
  @ApiProperty({ enum: WaPairingMethod, enumName: 'PairingMethod' })
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
