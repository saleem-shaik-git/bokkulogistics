import { Module } from '@nestjs/common';

import { InventoryModule } from '../inventory/inventory.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { BokkuCatalogueController } from './bokku.controller';
import { BokkuService } from './bokku.service';

@Module({
  imports: [InventoryModule, OrdersModule, PaymentsModule],
  controllers: [BokkuCatalogueController],
  providers: [BokkuService],
})
export class BokkuModule {}
