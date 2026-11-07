import { Inject, Injectable } from '@nestjs/common';
import { configuer } from '@libs/common';
import type { IAppConfig } from '@libs/common';

@Injectable()
export class ConnectionSupervisorService {
  constructor(@Inject(configuer.KEY) private readonly config: IAppConfig) {}

  next(retries: number, restartRequired = false): number | null {
    if (retries >= this.config.whatsapp.maxRetries) return null;
    // A restartRequired is fast, but still bounded and never recursive.
    if (restartRequired) return 250;
    return Math.floor(
      Math.min(60000, 1000 * 2 ** Math.min(retries, 16)) *
        (0.5 + Math.random() * 0.5),
    );
  }
}
