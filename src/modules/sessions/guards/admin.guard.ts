import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly digest: Buffer;
  constructor(private readonly configService:ConfigService) {
    const adminApiKey = this.configService.getOrThrow('WA_ADMIN_API_KEY')
    if (adminApiKey.length < 32)
      throw new Error('WA_ADMIN_API_KEY must contain at least 32 characters');
    this.digest = createHash('sha256')
      .update(adminApiKey)
      .digest();
  }
  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    http.getResponse<Response>().setHeader('Cache-Control', 'no-store');
    const authorization =
      http.getRequest<Request>().headers.authorization ?? '';
    const token = authorization.startsWith('Bearer ')
      ? authorization.slice(7)
      : '';
    if (
      !timingSafeEqual(this.digest, createHash('sha256').update(token).digest())
    )
      throw new UnauthorizedException();
    return true;
  }
}
