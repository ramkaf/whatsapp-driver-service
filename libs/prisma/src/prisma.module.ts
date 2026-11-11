import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from '../prisma.service.ts';
import { RepositoriesModule } from './repositories/repositories.module.ts';

@Global()
@Module({
  imports: [ConfigModule, RepositoriesModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
