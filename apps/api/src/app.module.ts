import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { RequestContextModule } from './common/request-context.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { HealthModule } from './modules/health/health.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { StoresModule } from './modules/stores/stores.module';
import { ProductsModule } from './modules/products/products.module';
import { CartModule } from './modules/cart/cart.module';
import { BokkuModule } from './modules/bokku/bokku.module';

@Module({
  imports: [
    AppConfigModule,
    RequestContextModule,
    DatabaseModule,
    AuditModule,
    AuthModule,
    UsersModule,
    HealthModule,
    StoresModule,
    ProductsModule,
    CartModule,
    BokkuModule,
  ],
  providers: [
    // Order matters: authenticate first, authorize second.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
