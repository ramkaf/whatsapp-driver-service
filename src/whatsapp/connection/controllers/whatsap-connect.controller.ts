import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  sessionSchema,
  qrSchema,
  errorSchema,
} from '../../../libs/common/docs/response-schemas.ts';
import { WhatsappConnectService } from '../providers/wa-connect.service.ts';
import { ApiOperationWithDocs } from '../../../libs/common/document/common-swagger.decorator.ts';
import { WhatsappAdminGuard } from '../guards/whatsapp-admin.guard.ts';
import { Auth } from '../../../libs/common/document/authentication.decorator.ts';

@Auth()
@ApiTags('WhatsApp Connection')
@Controller('whatsapp/connection')
export class WhatsappConnectController {
  constructor(
    private readonly WhatsappConnectService: WhatsappConnectService,
  ) {}

  @Post('connect')
  @ApiOperationWithDocs('Start or resume WhatsApp connection')
  async connect() {
    return this.WhatsappConnectService.connect();
  }

  @Get('status')
  @ApiOperationWithDocs('Get WhatsApp connection status')
  getStatus() {
    return this.WhatsappConnectService.getStatus();
  }

  @Post('reset-session')
  @ApiOperationWithDocs('Reset WhatsApp session / ریست نشست واتساپ')
  resetSession() {
    return this.WhatsappConnectService.resetSession();
  }

  @Get('qr')
  @ApiOperationWithDocs('Get the current WhatsApp pairing QR')
  async getQr() {
    return this.WhatsappConnectService.getQr();
  }
}
