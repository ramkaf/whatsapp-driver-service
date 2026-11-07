import { Module } from '@nestjs/common';
import { AuthStateService } from './auth-state/auth-state.service.js';
import { PrismaModule } from '@libs/prisma';

@Module({
  imports: [PrismaModule],
  providers: [AuthStateService],
  exports: [AuthStateService],
})
export class AuthStateModule {}
