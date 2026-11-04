import { Module } from '@nestjs/common';
import { PrismaModule } from '@libs/prisma';
import { AppConfigModule, RedisModule } from '@libs/common';

@Module({
  imports: [AppConfigModule, PrismaModule, RedisModule],
})
export class AppModule {}
