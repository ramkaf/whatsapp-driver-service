import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { appConfiguration } from '#common';

/** Only holders of the configured server API secret may reset the session. */
@Injectable()
export class WhatsappAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const token = appConfiguration().whatsapp.apiToken;
    if (!token)
      throw new ServiceUnavailableException(
        'WHATSAPP_API_TOKEN is not configured',
      );

    const request = context
      .switchToHttp()
      .getRequest<{ headers: { authorization?: string } }>();
    const match = /^Bearer ([^\s]+)$/i.exec(
      request.headers.authorization ?? '',
    );
    const supplied = Buffer.from(match?.[1] ?? '');
    const expected = Buffer.from(token);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      throw new UnauthorizedException('Invalid WhatsApp API bearer token');
    }
    return true;
  }
}
