import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

export type ApiErrorBody = {
  ok: false;
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
  requestId?: string;
  /** Extra structured payload (e.g. STOCK_CONFLICT.conflicts). */
  code?: string;
  details?: unknown;
};

/**
 * Global Nest exception filter — never leaks stack traces to clients,
 * always returns a stable JSON shape so the SPA can toast without freezing.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const raw =
      exception instanceof HttpException ? exception.getResponse() : null;

    let message: string | string[] = 'Internal server error';
    let errorName = 'Internal Server Error';
    let code: string | undefined;
    let details: unknown;

    if (typeof raw === 'string') {
      message = raw;
      errorName = HttpStatus[status] ?? errorName;
    } else if (raw && typeof raw === 'object') {
      const body = raw as {
        message?: string | string[];
        error?: string;
        code?: string;
        conflicts?: unknown;
      };
      message = body.message ?? message;
      errorName = body.error ?? errorName;
      code = body.code;
      if (body.conflicts !== undefined) {
        details = { conflicts: body.conflicts };
      }
    } else if (exception instanceof Error) {
      message =
        status === HttpStatus.INTERNAL_SERVER_ERROR
          ? 'Internal server error'
          : exception.message;
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} → ${status}: ${String(message)}`);
    }

    const payload: ApiErrorBody = {
      ok: false,
      statusCode: status,
      error: errorName,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
      requestId: request.header('x-request-id') ?? undefined,
      code,
      details,
    };

    response.status(status).json(payload);
  }
}
