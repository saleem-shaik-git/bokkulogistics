import { SetMetadata } from '@nestjs/common';
import { CallHandler, ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { ApiSuccess } from '@bokku/shared';

export const RAW_RESPONSE_KEY = 'rawResponse';
/** Opt out of the { success, data } envelope (e.g. the health endpoint shape). */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);

/** Wraps successful handler payloads in the standard success envelope. */
@Injectable()
export class TransformInterceptor implements NestInterceptor<
  unknown,
  ApiSuccess<unknown> | unknown
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw) {
      return next.handle();
    }
    return next.handle().pipe(
      map((data) => {
        const envelope: ApiSuccess<unknown> = { success: true, data };
        return envelope;
      }),
    );
  }
}
