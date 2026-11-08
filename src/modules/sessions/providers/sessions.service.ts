import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { configuer } from '@libs/common';
import type { IAppConfig } from '@libs/common';
import { SessionRepository } from '../session.repository.ts';
import { SessionManagerService } from '../../connection/providers/session/session-manager.service.ts';
import { SessionQueue } from '../../connection/session-queue.ts';
import type { CreateSessionDto } from '../dto/sessions.dto.ts';
import { normalizePhone } from '../phone.ts';

// ساخت، مشاهده و عملیات مدیریتی سشن‌ها را بین مخزن داده و مدیر اتصال هماهنگ می‌کند.
@Injectable()
export class SessionsService {
  private readonly creation = new SessionQueue();
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly sessionManagerService: SessionManagerService,
    @Inject(configuer.KEY) private readonly config: IAppConfig,
  ) {}

  async create(dto: CreateSessionDto) {
    return this.creation.run('create', async () => {
      if (
        (await this.sessionRepository.count()) >=
        this.config.whatsapp.maxSessions
      )
        throw new ConflictException('Session limit reached');
      const row = await this.sessionRepository.create({
        name: dto.name,
        pairingMethod: dto.pairingMethod,
        phone: dto.phone ? normalizePhone(dto.phone) : undefined,
      });
      try {
        await this.sessionManagerService.start(row.id);
      } catch {
        this.logger.warn({
          sessionId: row.id,
          event: 'initial_connection_failed',
        });
      }
      return this.details(row.id);
    });
  }
  async list() {
    const rows = await this.sessionRepository.list();
    return rows.map((row) => ({
      ...row,
      runtime: this.sessionManagerService.snapshot(row.id),
    }));
  }
  async details(id: string) {
    const row = await this.sessionRepository.require(id);
    return { ...row, runtime: this.sessionManagerService.snapshot(id) };
  }
  async reconnect(id: string) {
    await this.sessionManagerService.restart(id);
    return this.details(id);
  }
  async disconnect(id: string) {
    await this.sessionManagerService.stop(id);
    return this.details(id);
  }
  async logout(id: string) {
    await this.sessionManagerService.logout(id);
    return this.details(id);
  }
  async remove(id: string) {
    await this.sessionManagerService.remove(id);
  }
}
