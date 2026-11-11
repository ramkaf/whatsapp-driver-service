import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLIENT_REDIS, type IClientRedis } from '@libs/common';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  getHello(): string {
    this.logger.debug('Handling getHello request');
    return 'Hello World!';
  }
}
