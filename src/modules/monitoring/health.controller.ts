import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { HealthResponseDto } from './health-response.dto.ts';
import { ApiErrorResponseDto } from '../sessions/sessions/sessions-response.dto.ts';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { SessionsService } from '../sessions/sessions/sessions.service.ts';
import { AdminGuard } from '../sessions/admin.guard.ts';

@Controller('health')
@ApiTags('Health')
@ApiBearerAuth('admin-token')
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
@ApiServiceUnavailableResponse({
  description: 'Persistence unavailable.',
  type: ApiErrorResponseDto,
})
@UseGuards(AdminGuard)
export class HealthController {
  constructor(private readonly sessions: SessionsService) {}
  @Get()
  @ApiOperation({
    summary: 'Get process health and aggregate session counts',
    description: 'No pairing secrets or authentication records are returned.',
  })
  @ApiOkResponse({ type: HealthResponseDto })
  async health() {
    const sessions = await this.sessions.list();
    const counts = {
      total: sessions.length,
      connected: 0,
      disconnected: 0,
      reconnecting: 0,
      failed: 0,
      pairing: 0,
    };
    for (const session of sessions) {
      if (session.runtime.connected) counts.connected++;
      else if (['CONNECTING', 'RECONNECTING'].includes(session.runtime.status))
        counts.reconnecting++;
      else if (
        session.runtime.status === 'FAILED' ||
        session.status === 'FAILED'
      )
        counts.failed++;
      else if (
        ['AWAITING_PAIRING', 'AUTHENTICATING'].includes(session.runtime.status)
      )
        counts.pairing++;
      else counts.disconnected++;
    }
    return {
      status: counts.failed ? 'degraded' : 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      sessions: counts,
    };
  }
}
