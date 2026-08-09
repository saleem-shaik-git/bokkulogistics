import { Module } from '@nestjs/common';

import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { RequestContextModule } from './common/request-context.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [AppConfigModule, RequestContextModule, DatabaseModule, HealthModule],
})
export class AppModule {}
