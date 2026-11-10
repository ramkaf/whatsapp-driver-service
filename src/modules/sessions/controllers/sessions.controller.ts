import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SessionsService } from '../providers/sessions.service.ts';
import { PairingService } from '../../pairing/providers/pairing.service.ts';
import { CreateSessionDto, PairingCodeDto } from '../dto/sessions.dto.ts';
import {
  ApiErrorResponseDto,
  PairingCodeResponseDto,
  QrResponseDto,
  SessionResponseDto,
} from '../dto/sessions-response.dto.ts';
import { AdminGuard } from '../guards/admin.guard.ts';
import { PairingMethodEnum } from '../interfaces/session.interface.ts';

const ApiSessionId = () =>
  applyDecorators(
    ApiParam({
      name: 'id',
      description: 'Copy the id returned by POST /sessions.',
      example: 'cmh1234560000sessionexample',
    }),
    ApiNotFoundResponse({
      description: 'Session not found.',
      type: ApiErrorResponseDto,
    }),
  );

// APIهای محافظت‌شدهٔ مدیریت سشن، جفت‌سازی و کنترل اتصال حساب‌های واتساپ را ارائه می‌کند.
@Controller('sessions')
@ApiTags('Sessions')
@ApiBearerAuth('admin-token')
@ApiBadRequestResponse({
  description: 'Invalid body or phone number.',
  type: ApiErrorResponseDto,
})
@ApiUnauthorizedResponse({
  description: 'Missing or invalid WA_ADMIN_API_KEY.',
  type: ApiErrorResponseDto,
})
@ApiConflictResponse({
  description:
    'Session limit reached, or operation conflicts with the current state.',
  type: ApiErrorResponseDto,
})
@ApiServiceUnavailableResponse({
  description: 'Persistence or connection is unavailable.',
  type: ApiErrorResponseDto,
})
@ApiInternalServerErrorResponse({
  description: 'Unexpected internal failure.',
  type: ApiErrorResponseDto,
})
@UseGuards(AdminGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly pairingService: PairingService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create a session and start connecting',
    description:
      'Choose CODE or QR. A phone is required for both methods. Reusing a phone retires its old session and credentials remain isolated by ID. Retrieve pairing data from its dedicated endpoint; the create response does not mean the account is connected.',
  })
  @ApiBody({
    type: CreateSessionDto,
    examples: {
      code: {
        summary: 'Pair using a phone number and code',
        value: {
          name: 'WhatsApp 01',
          phone: '989121234567',
          pairingMethod: 'CODE',
        },
      },
      qr: {
        summary: 'Pair by scanning a QR',
        value: {
          name: 'WhatsApp 02',
          phone: '989131234567',
          pairingMethod: PairingMethodEnum.QR,
        },
      },
    },
  })
  @ApiCreatedResponse({ type: SessionResponseDto })
  create(@Body() dto: CreateSessionDto) {
    return this.sessionsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List current session versions with runtime state' })
  @ApiOkResponse({ type: SessionResponseDto, isArray: true })
  list() {
    return this.sessionsService.list();
  }

  @Get(':id')
  @ApiSessionId()
  @ApiOperation({
    summary: 'Get session metadata and current connectivity',
    description:
      'Success is runtime.connected=true. Persisted status alone can reflect a previous process.',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  details(@Param('id') id: string) {
    return this.sessionsService.details(id);
  }

  @Post(':id/pairing-code')
  @HttpCode(200)
  @ApiTags('Pairing')
  @ApiSessionId()
  @ApiOperation({
    summary: 'Request or reuse a pairing code',
    description:
      'Send {} to use the stored phone. Waits for readiness, shares simultaneous requests and reuses an unexpired code. Enter the returned code on the phone, then check status. Codes are secrets.',
  })
  @ApiBody({
    type: PairingCodeDto,
    examples: {
      storedPhone: { summary: 'Use the session phone', value: {} },
      phone: {
        summary: 'Provide a phone for a session without one',
        value: { phone: '989121234567' },
      },
    },
  })
  @ApiOkResponse({ type: PairingCodeResponseDto })
  @ApiResponse({
    status: 429,
    description: 'New code requests are rate limited.',
    type: ApiErrorResponseDto,
  })
  code(@Param('id') id: string, @Body() dto: PairingCodeDto) {
    return this.pairingService.requestPairingCode(id, dto.phone);
  }

  @Get(':id/qr')
  @ApiTags('Pairing')
  @ApiSessionId()
  @ApiOperation({
    summary: 'Read the current QR payload',
    description:
      'Does not restart the socket. The raw QR string is null while not ready, expired, authenticated, or CODE is selected. Render locally with a trusted QR renderer and refresh on change. Swagger displays the string, not a QR image.',
  })
  @ApiOkResponse({ type: QrResponseDto })
  qr(@Param('id') id: string) {
    return this.pairingService.qr(id);
  }

  @Post(':id/qr')
  @HttpCode(200)
  @ApiTags('Pairing')
  @ApiSessionId()
  @ApiOperation({
    summary: 'Start or renew QR pairing for an unregistered session',
    description:
      'Then poll GET /sessions/:id/qr until qr is available. Already paired accounts must use reconnect.',
  })
  @ApiOkResponse({ type: QrResponseDto })
  startQr(@Param('id') id: string) {
    return this.pairingService.startQr(id);
  }

  @Post(':id/reconnect')
  @HttpCode(200)
  @ApiSessionId()
  @ApiOperation({
    summary: 'Manually restart a session',
    description:
      'Enables recovery, resets retry count and reuses persisted credentials. Logged-out sessions require explicit pairing.',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  reconnect(@Param('id') id: string) {
    return this.sessionsService.reconnect(id);
  }

  @Post(':id/disconnect')
  @HttpCode(200)
  @ApiSessionId()
  @ApiOperation({
    summary: 'Disconnect without logout',
    description:
      'Preserves authentication and disables automatic reconnect, including after application restart. Resume with reconnect.',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  disconnect(@Param('id') id: string) {
    return this.sessionsService.disconnect(id);
  }

  @Post(':id/logout')
  @HttpCode(200)
  @ApiSessionId()
  @ApiOperation({
    summary: 'Explicitly log out of WhatsApp',
    description:
      'Requires a connected session. Clears local authentication only after remote logout is confirmed. Pairing will be required again.',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  logout(@Param('id') id: string) {
    return this.sessionsService.logout(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiSessionId()
  @ApiOperation({
    summary: 'Soft-delete a session and disconnect its socket',
    description:
      'Sets isEnabled=false, cancels retries and stops the socket. Retains session metadata, credentials, keys and events. The disabled session remains visible and will not reconnect after application restart. Resume explicitly with reconnect; remote logout is a separate operation.',
  })
  @ApiNoContentResponse({ description: 'Session disabled and socket stopped.' })
  remove(@Param('id') id: string) {
    return this.sessionsService.remove(id);
  }
}
