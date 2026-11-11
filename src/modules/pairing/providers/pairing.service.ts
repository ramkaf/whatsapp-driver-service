import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { SessionManagerService } from '../../connection/providers/session/session-manager.service.ts';
import { WA_SESSION_REPOSITORY, type IWaSessionRepository } from '@libs/prisma';
import { normalizePhone } from '../../sessions/phone.ts';
import { PairingMethodEnum } from '../../sessions/interfaces/session.interface.ts';

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
    @Inject(WA_SESSION_REPOSITORY)
    private readonly sessionRepository: IWaSessionRepository,
  ) {}
  /** Starts or renews QR pairing without interrupting an in-flight code request. */
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
  async startQr(id: string) {
    if (this.requests.has(id))
      throw new BadRequestException('A pairing code request is in progress');
    await this.sessionManagerService.preparePairing(id, PairingMethodEnum.QR);
    return this.qr(id);
  }
  async requestPairingCode(
    id: string,
    phone?: string,
  ): Promise<PairingCodeResponse> {
    const row = await this.sessionRepository.require(id);
    const suppliedPhone = phone === undefined ? row.phone : phone;
    if (!suppliedPhone) {
      throw new BadRequestException(
        'A phone number is required for pairing code',
      );
    }
    const number = normalizePhone(suppliedPhone);
    const existing = this.requests.get(id);

    if (existing) {
      if (existing.phone !== number) {
        throw new ConflictException('Pairing request already in progress');
      }
      return existing.promise;
    }
    const request = this.executePairingCode(id, number);
    this.requests.set(id, {
      phone: number,
      promise: request,
    });

    try {
      return await request;
    } finally {
      if (this.requests.get(id)?.promise === request) {
        this.requests.delete(id);
      }
    }
  }
  private async executePairingCode(
    id: string,
    number: string,
  ): Promise<PairingCodeResponse> {
    await this.sessionManagerService.preparePairing(
      id,
      PairingMethodEnum.CODE,
      number,
    );

    const result = await this.sessionManagerService.requestPairingCode(
      id,
      number,
    );

    return {
      sessionId: id,
      pairingMethod: PairingMethodEnum.CODE,
      status: 'AWAITING_PAIRING',
      ...result,
    };
  }
}
