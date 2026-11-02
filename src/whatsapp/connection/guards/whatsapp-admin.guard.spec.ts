import type { ExecutionContext } from '@nestjs/common';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { WhatsappAdminGuard } from './whatsapp-admin.guard.ts';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { WhatsappConnectController } from '../controllers/whatsap-connect.controller.ts';

function context(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as ExecutionContext;
}

describe('reset session authentication', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('protects the reset route even when WhatsApp is logged out', () => {
    const reset = Object.getOwnPropertyDescriptor(
      WhatsappConnectController.prototype,
      'resetSession',
    )!.value as object;
    expect(Reflect.getMetadata(GUARDS_METADATA, reset)).toContain(
      WhatsappAdminGuard,
    );
  });

  it('accepts only the configured server token', () => {
    vi.stubEnv('WHATSAPP_API_TOKEN', 'test-admin-secret');
    const guard = new WhatsappAdminGuard();
    expect(guard.canActivate(context('Bearer test-admin-secret'))).toBe(true);
    for (const header of [
      undefined,
      '',
      'Basic test-admin-secret',
      'Bearer wrong',
      'Bearer test-admin-secrex',
    ]) {
      expect(() => guard.canActivate(context(header))).toThrow(
        UnauthorizedException,
      );
    }
  });

  it('fails closed when no token is configured', () => {
    vi.stubEnv('WHATSAPP_API_TOKEN', '');
    expect(() => new WhatsappAdminGuard().canActivate(context())).toThrow(
      ServiceUnavailableException,
    );
  });
});
