import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SessionManagerService } from '../../connection/providers/session/session-manager.service.ts';
import { ConfigService } from '@nestjs/config';

// به‌صورت دوره‌ای اتصال‌های بسته یا معطل را بررسی و بازیابی آن‌ها را به مدیر سشن واگذار می‌کند.
@Injectable()
export class ConnectionWatchdogService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ConnectionWatchdogService.name);
  private timer: NodeJS.Timeout | null = null;
  private checking: Promise<void> | null = null;
  constructor(
    private readonly manager: SessionManagerService,
    private readonly configService:ConfigService
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => {
      if (this.checking) return;
      this.checking = this.manager
        .inspectConnections()
        .catch((error) =>
          this.logger.error({ event: 'watchdog_check_failed', error }),
        )
        .finally(() => {
          this.checking = null;
        });
    }, this.configService.getOrThrow('WA_WATCHDOG_INTERVAL_MS'));
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.checking;
  }
}
