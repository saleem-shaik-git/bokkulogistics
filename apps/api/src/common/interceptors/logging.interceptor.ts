import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

const SENSITIVE_KEYS = ['password', 'token', 'secret', 'authorization', 'cookie'];

/** Structured one-line JSON log per request. Never logs secrets. */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const started = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.log(req, res, Date.now() - started),
        error: () => this.log(req, res, Date.now() - started),
      }),
    );
  }

  private log(req: Request, res: Response, responseTimeMs: number): void {
    const entry = {
      requestId: req.id ?? 'unknown',
      // Populated by auth guard in later phases; placeholder for shape stability.
      userId: (req as Request & { user?: { id?: string } }).user?.id ?? null,
      method: req.method,
      path: this.sanitize(req.originalUrl ?? req.url),
      statusCode: res.statusCode,
      responseTimeMs,
    };
    this.logger.log(JSON.stringify(entry));
  }

  /** Strip query parameters that could carry secrets from logged paths. */
  private sanitize(url: string): string {
    const [path, query] = url.split('?');
    if (!query) return url;
    const safeParams = query
      .split('&')
      .map((pair) => {
        const key = pair.split('=')[0]?.toLowerCase() ?? '';
        return SENSITIVE_KEYS.some((k) => key.includes(k)) ? `${key}=[redacted]` : pair;
      })
      .join('&');
    return `${path}?${safeParams}`;
  }
}
