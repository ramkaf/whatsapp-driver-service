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
import { SessionsService } from './sessions.service.ts';
import { PairingService } from '../../pairing/pairing/pairing.service.ts';
import {
  CreateSessionDto,
  PairingCodeDto,
  PairingMethodDto,
} from './sessions.dto.ts';
import {
  ApiErrorResponseDto,
  PairingCodeResponseDto,
  QrResponseDto,
  SessionResponseDto,
} from './sessions-response.dto.ts';
import { AdminGuard } from '../admin.guard.ts';

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
    'Duplicate phone, session limit reached, or operation conflicts with the current state.',
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
    private readonly sessions: SessionsService,
    private readonly pairing: PairingService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create a session and start connecting',
    description:
      'Choose CODE or QR. A phone is required for CODE. Retrieve pairing data from its dedicated endpoint; the create response does not mean the account is connected.',
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
        value: { name: 'WhatsApp 02', pairingMethod: 'QR' },
      },
    },
  })
  @ApiCreatedResponse({ type: SessionResponseDto })
  create(@Body() dto: CreateSessionDto) {
    return this.sessions.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List sessions with current runtime state' })
  @ApiOkResponse({ type: SessionResponseDto, isArray: true })
  list() {
    return this.sessions.list();
  }

  @Get(':id')
  @ApiSessionId()
  @ApiOperation({ summary: 'Get session metadata and runtime' })
  @ApiOkResponse({ type: SessionResponseDto })
  details(@Param('id') id: string) {
    return this.sessions.details(id);
  }

  @Get(':id/status')
  @ApiSessionId()
  @ApiOperation({
    summary: 'Check current connectivity',
    description:
      'Success is runtime.connected=true. Persisted status alone can reflect a previous process.',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  status(@Param('id') id: string) {
    return this.sessions.details(id);
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
    return this.pairing.code(id, dto.phone);
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
    return this.pairing.qr(id);
  }

  @Post(':id/pairing-method')
  @HttpCode(200)
  @ApiTags('Pairing')
  @ApiSessionId()
  @ApiOperation({
    summary: 'Select CODE or QR for an unregistered session',
    description:
      'Explicitly renew expired pairing or switch method without creating a duplicate socket. For a paired session use reconnect.',
  })
  @ApiBody({
    type: PairingMethodDto,
    examples: {
      qr: { value: { pairingMethod: 'QR' } },
      code: { value: { pairingMethod: 'CODE', phone: '989121234567' } },
    },
  })
  @ApiOkResponse({ type: QrResponseDto })
  method(@Param('id') id: string, @Body() dto: PairingMethodDto) {
    return this.pairing.select(id, dto.pairingMethod, dto.phone);
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
    return this.sessions.reconnect(id);
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
    return this.sessions.disconnect(id);
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
    return this.sessions.logout(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiSessionId()
  @ApiOperation({
    summary: 'Delete the local session and authentication',
    description:
      'Stops the socket and deletes local credentials, keys and events. Does not remotely unlink the WhatsApp device; log out first if remote unlinking is desired.',
  })
  @ApiNoContentResponse({ description: 'Local session deleted.' })
  remove(@Param('id') id: string) {
    return this.sessions.remove(id);
  }
}
