import { Module } from '@nestjs/common';
import { PrismaModule } from '@libs/prisma';
import { SessionRepository } from './session.repository.ts';

@Module({
  imports: [PrismaModule],
  providers: [SessionRepository],
  exports: [SessionRepository],
})
export class SessionDataModule {}
