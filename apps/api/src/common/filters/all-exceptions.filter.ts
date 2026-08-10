import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiFailure } from '@bokku/shared';

/** Error codes for client-consumable failures (Phase 1 subset). */
export const ERROR_CODE_INTERNAL = 'INTERNAL_SERVER_ERROR';

interface ExceptionBody {
  message?: string | string[];
  error?: string;
  code?: string;
}

/**
 * Normalizes every thrown error to the spec'd envelope:
 *   { success: false, error: { code, message }, requestId }
 * Never leaks stack traces or internals to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = ERROR_CODE_INTERNAL;
    let message = 'An unexpected error occurred';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as string | ExceptionBody;
      if (typeof body === 'string') {
        message = body;
      } else {
        message = Array.isArray(body.message)
          ? body.message.join('; ')
          : (body.message ?? exception.message);
        code = body.code ?? this.toErrorCode(body.error ?? exception.name ?? 'HTTP_ERROR');
      }
    } else if (exception instanceof Error) {
      // Body-parser / stream errors are NOT HttpExceptions — they carry
      // `.status`/`.type` (e.g. entity.too.large, entity.parse.failed).
      // Map them to honest 4xx instead of a misleading 500.
      const statusFromParser = this.bodyParserStatus(exception);
      if (statusFromParser) {
        status = statusFromParser;
        code =
          statusFromParser === HttpStatus.PAYLOAD_TOO_LARGE ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST';
        message =
          statusFromParser === HttpStatus.PAYLOAD_TOO_LARGE
            ? 'Request body too large'
            : 'Invalid request body';
      } else {
        this.logger.error(
          `Unhandled error [${req.id ?? 'no-request-id'}]: ${exception.message}`,
          exception.stack,
        );
      }
    }

    const payload: ApiFailure = {
      success: false,
      error: { code, message },
      requestId: req.id ?? 'unknown',
    };
    res.status(status).json(payload);
  }

  /** "Bad Request" → "BAD_REQUEST" */
  private toErrorCode(name: string): string {
    const cleaned = name.replace(/exception$/i, '').trim();
    if (!cleaned) return 'ERROR';
    return cleaned
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[\s-]+/g, '_')
      .toUpperCase();
  }

  /**
   * Body-parser failures carry `type: 'entity.*'` plus a numeric status
   * (413 entity.too.large, 400 entity.parse.failed). Returns the status
   * when the shape matches, otherwise null (a real 500 candidate).
   */
  private bodyParserStatus(exception: Error): number | null {
    const candidate = exception as Error & { status?: number; statusCode?: number; type?: string };
    if (typeof candidate.type !== 'string' || !candidate.type.startsWith('entity.')) return null;
    const status = candidate.status ?? candidate.statusCode;
    if (typeof status !== 'number' || status < 400 || status >= 500) return null;
    return status;
  }
}
