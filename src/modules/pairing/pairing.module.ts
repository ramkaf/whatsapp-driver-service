import { Module } from '@nestjs/common';
import { PairingService } from './pairing/pairing.service.ts';
import { ConnectionModule } from '../connection/connection.module.ts';
import { SessionDataModule } from '../sessions/session-data.module.ts';

@Module({
  imports: [ConnectionModule, SessionDataModule],
  providers: [PairingService],
  exports: [PairingService],
})
export class PairingModule {}
