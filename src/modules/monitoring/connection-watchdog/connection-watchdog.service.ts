import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { configuer } from '@libs/common';
import type { IAppConfig } from '@libs/common';
import { SessionManagerService } from '../../connection/session-manager/session-manager.service.ts';

@Injectable()
export class ConnectionWatchdogService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ConnectionWatchdogService.name);
  private timer: NodeJS.Timeout | null = null;
  private checking: Promise<void> | null = null;
  constructor(
    private readonly manager: SessionManagerService,
    @Inject(configuer.KEY) private readonly config: IAppConfig,
  ) {}
  onApplicationBootstrap() {
    this.timer = setInterval(() => {
      if (this.checking) return;
      this.checking = this.manager
        .inspectConnections()
        .catch(() => this.logger.error({ event: 'watchdog_check_failed' }))
        .finally(() => {
          this.checking = null;
        });
    }, this.config.whatsapp.watchdogIntervalMs);
    this.timer.unref();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.checking;
  }
}
