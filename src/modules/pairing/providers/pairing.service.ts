import { BadRequestException, Injectable } from '@nestjs/common';
import { SessionManagerService } from '../../connection/providers/session/session-manager.service.ts';
import { SessionRepository } from '../../sessions/session.repository.ts';
import { normalizePhone } from '../../sessions/phone.ts';

export interface PairingCodeResponse {
  sessionId: string;
  pairingMethod: 'CODE';
  status: 'AWAITING_PAIRING';
  code: string;
  expiresAt: string;
}

// انتخاب روش جفت‌سازی، دریافت QR و درخواست کد اتصال با اعتبارسنجی شماره را هماهنگ می‌کند.
@Injectable()
export class PairingService {
  private readonly requests = new Map<
    string,
    { phone: string; promise: Promise<PairingCodeResponse> }
  >();
  constructor(
    private readonly sessionManagerService: SessionManagerService,
    private readonly sessionRepository: SessionRepository,
  ) {}

  async code(id: string, phone?: string): Promise<PairingCodeResponse> {
    const row = await this.sessionRepository.require(id);
    const number = phone ? normalizePhone(phone) : row.phone;
    if (!number)
      throw new BadRequestException(
        'A phone number is required for pairing code',
      );
    const pending = this.requests.get(id);
    if (pending) {
      if (pending.phone !== number)
        throw new BadRequestException(
          'A request for another phone is in progress',
        );
      return pending.promise;
    }
    const request = (async (): Promise<PairingCodeResponse> => {
      await this.sessionManagerService.preparePairing(id, 'CODE', number);
      const result = await this.sessionManagerService.requestPairingCode(id, number);
      return {
        sessionId: id,
        pairingMethod: 'CODE',
        status: 'AWAITING_PAIRING',
        ...result,
      };
    })();
    this.requests.set(id, { phone: number, promise: request });
    try {
      return await request;
    } finally {
      if (this.requests.get(id)?.promise === request) this.requests.delete(id);
    }
  }

  async qr(id: string) {
    const row = await this.sessionRepository.require(id);
    // Reading the endpoint never replaces or creates a socket.
    return {
      sessionId: id,
      pairingMethod: row.pairingMethod,
      status: this.sessionManagerService.snapshot(id).status,
      ...this.sessionManagerService.pairing(id),
    };
  }

  async select(id: string, method: 'CODE' | 'QR', phone?: string) {
    if (this.requests.has(id))
      throw new BadRequestException('A pairing code request is in progress');
    let number = phone !== undefined ? normalizePhone(phone) : undefined;
    if (method === 'CODE' && !number) {
      const row = await this.sessionRepository.require(id);
      if (!row.phone)
        throw new BadRequestException(
          'A phone number is required for pairing code',
        );
      number = normalizePhone(row.phone);
    }
    await this.sessionManagerService.preparePairing(id, method, number);
    return this.qr(id);
  }
}
