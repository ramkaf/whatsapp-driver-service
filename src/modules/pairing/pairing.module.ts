import { Module } from '@nestjs/common';
import { PairingService } from './providers/pairing.service.ts';
import { ConnectionModule } from '../connection/connection.module.ts';
import { SessionDataModule } from '../sessions/session-data.module.ts';

// سرویس جفت‌سازی واتساپ با QR یا کد را به مدیریت اتصال و داده‌های سشن متصل می‌کند.
@Module({
  imports: [ConnectionModule, SessionDataModule],
  providers: [PairingService],
  exports: [PairingService],
})
export class PairingModule {}
