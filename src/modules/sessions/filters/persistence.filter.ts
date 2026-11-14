
import { Prisma } from '@database/client.js';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Logger,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class PersistenceFilter implements ExceptionFilter {
  private readonly logger = new Logger(PersistenceFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (error instanceof HttpException) {
      const status = error.getStatus();
      const body = error.getResponse();

      response
        .status(status)
        .json(
          typeof body === 'string'
            ? { statusCode: status, message: body }
            : body,
        );

      return;
    }

    const exception =
      error instanceof Error
        ? error
        : new Error(String(error));

    const prismaCode =
      error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code
        : undefined;

    const persistence =
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientUnknownRequestError ||
      error instanceof Prisma.PrismaClientInitializationError ||
      error instanceof Prisma.PrismaClientValidationError;

    const status =
      prismaCode === 'P2002'
        ? 409
        : prismaCode === 'P2025'
          ? 404
          : persistence
            ? 503
            : 500;

    // Log the actual exception details.
    this.logger.error({
      event: 'request_failed',
      name: exception.name,
      message: exception.message,
      code: prismaCode ?? ('code' in exception ? exception.code : undefined),
      stack: exception.stack,
    });

    response.status(status).json({
      statusCode: status,
      message:
        status === 409
          ? 'The operation conflicts with existing data'
          : status === 404
            ? 'Resource not found'
            : status === 503
              ? 'Persistence is unavailable'
              : 'Internal server error',
    });
  }
}
