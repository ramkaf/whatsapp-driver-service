import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import QRCode from 'qrcode';
import { AdminGuard } from '../sessions/guards/admin.guard.ts';
import { SessionManagerService } from '../connection/providers/session/session-manager.service.ts';

// صفحهٔ آزمایش اتصال واتساپ و تصویر QR محافظت‌شدهٔ هر سشن را به مرورگر ارائه می‌کند.
@Controller('test-panel')
export class UiTestController {
  constructor(private readonly manager: SessionManagerService) {}

  @Get()
  page(@Res() response: Response): void {
    response.setHeader('Cache-Control', 'no-store');
    const sourcePage = join(
      process.cwd(),
      'src/modules/ui-test/public/test-panel.html',
    );
    const builtPage = join(
      process.cwd(),
      'dist/src/modules/ui-test/public/test-panel.html',
    );
    response.sendFile(existsSync(sourcePage) ? sourcePage : builtPage);
  }

  @Get(':id/qr-image')
  @UseGuards(AdminGuard)
  async qr(@Param('id') id: string) {
    const pairing = this.manager.pairing(id);
    return {
      expiresAt: pairing.expiresAt,
      image: pairing.qr
        ? await QRCode.toDataURL(pairing.qr, { width: 280 })
        : null,
    };
  }
}
