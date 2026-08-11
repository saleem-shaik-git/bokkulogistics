import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { RequestIdMiddleware } from './middleware/request-id.middleware';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { TransformInterceptor } from './interceptors/transform.interceptor';
import { LoggingInterceptor } from './interceptors/logging.interceptor';

/**
 * Cross-cutting request pipeline, applied in this order:
 *   RequestIdMiddleware → LoggingInterceptor → TransformInterceptor →
 *   AllExceptionsFilter
 */
@Module({
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class RequestContextModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Nest 11 / path-to-regexp v8 wildcard syntax.
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
