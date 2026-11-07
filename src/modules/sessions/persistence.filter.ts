import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Logger,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@libs/prisma';

@Catch()
export class PersistenceFilter implements ExceptionFilter {
  private readonly logger = new Logger(PersistenceFilter.name);
  catch(error: Error & { code?: string }, host: ArgumentsHost) {
    if (error instanceof HttpException) {
      host
        .switchToHttp()
        .getResponse<Response>()
        .status(error.getStatus())
        .json(
          typeof error.getResponse() === 'string'
            ? { statusCode: error.getStatus(), message: error.getResponse() }
            : error.getResponse(),
        );
      return;
    }
    const persistence =
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientUnknownRequestError ||
      error instanceof Prisma.PrismaClientInitializationError ||
      error instanceof Prisma.PrismaClientValidationError ||
      error instanceof AggregateError;
    const status =
      error.code === 'P2002'
        ? 409
        : error.code === 'P2025'
          ? 404
          : persistence
            ? 503
            : 500;
    this.logger.error({
      event: 'request_failed',
      code: error.code ?? error.name,
    });
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({
        statusCode: status,
        message:
          status === 409
            ? 'A session with this phone already exists'
            : status === 404
              ? 'Session not found'
              : status === 503
                ? 'Persistence is unavailable'
                : 'Internal server error',
      });
  }
}
