import { ApiProperty } from '@nestjs/swagger';

export class SessionCountsDto {
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 0 }) connected: number;
  @ApiProperty({ example: 0 }) disconnected: number;
  @ApiProperty({ example: 1 }) reconnecting: number;
  @ApiProperty({ example: 0 }) failed: number;
  @ApiProperty({ example: 0 }) pairing: number;
}

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'degraded'], example: 'ok' }) status: string;
  @ApiProperty({ example: 120 }) uptimeSeconds: number;
  @ApiProperty({ type: () => SessionCountsDto }) sessions: SessionCountsDto;
}
