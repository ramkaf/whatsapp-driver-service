import { Module } from '@nestjs/common';
import { AppConfigModule } from '@libs/common';
import { PrismaService } from './prisma.service.ts';

@Module({
  imports: [AppConfigModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
