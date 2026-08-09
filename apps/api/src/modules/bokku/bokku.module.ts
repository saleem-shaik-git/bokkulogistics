import { Module } from '@nestjs/common';

import { InventoryModule } from '../inventory/inventory.module';
import { BokkuCatalogueController } from './bokku.controller';
import { BokkuService } from './bokku.service';

@Module({
  imports: [InventoryModule],
  controllers: [BokkuCatalogueController],
  providers: [BokkuService],
})
export class BokkuModule {}
