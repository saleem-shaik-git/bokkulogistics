import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { EnvConfig } from '@bokku/config';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { API_GLOBAL_PREFIX, API_VERSION } from './config/constants';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Structured request logging is handled by LoggingInterceptor.
    logger: ['error', 'warn', 'log'],
  });

  // Security headers. CSP is relaxed for Swagger UI assets.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'validator.swagger.io'],
        },
      },
    }),
  );

  // CORS: preview environments use rotating subdomains, so origins are
  // restricted via CORS_ORIGINS in production and open in development.
  app.enableCors(
    process.env.NODE_ENV === 'production'
      ? {
          origin: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
          credentials: true,
        }
      : { origin: true, credentials: true },
  );

  app.setGlobalPrefix(`${API_GLOBAL_PREFIX}/${API_VERSION}`);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableShutdownHooks();
  const config = app.get<EnvConfig>('ENV_CONFIG');
  const swaggerConfig = new DocumentBuilder()
    .setTitle(config.APP_NAME)
    .setDescription(
      'Bokku Logistics REST API — commerce & delivery orchestration. ' +
        'All endpoints are versioned under /api/v1 and return the standard ' +
        '{ success, data | error } envelope.',
    )
    .setVersion('1.0')
    .addServer(`/${API_GLOBAL_PREFIX}/${API_VERSION}`)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .addTag('Health', 'Service liveness and dependency checks')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // Served at /api/docs (spec requirement).
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(config.PORT, '0.0.0.0');
  logger.log(`API listening on http://0.0.0.0:${config.PORT}/${API_GLOBAL_PREFIX}/${API_VERSION}`);
  logger.log(`Swagger UI available at http://0.0.0.0:${config.PORT}/api/docs`);
}

bootstrap().catch((error: unknown) => {
  console.error('Fatal error during bootstrap:', error);
  process.exit(1);
});
