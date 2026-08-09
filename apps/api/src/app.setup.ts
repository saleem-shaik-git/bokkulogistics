import { ValidationPipe, type INestApplication } from '@nestjs/common';

import { API_GLOBAL_PREFIX, API_VERSION } from './config/constants';

/**
 * App-wide HTTP configuration shared by production bootstrapping (main.ts)
 * and integration tests — keeps both exercising identical behavior.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(`${API_GLOBAL_PREFIX}/${API_VERSION}`);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
}
