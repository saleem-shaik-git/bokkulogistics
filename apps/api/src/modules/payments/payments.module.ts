import { Module } from '@nestjs/common';

import { PaymentsIntegrationModule } from '../../integrations/payments/payments.integration.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { OrderPlacementController } from '../orders/order-placement.controller';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';

@Module({
  imports: [PaymentsIntegrationModule, CheckoutModule, OrdersModule],
  controllers: [PaymentsController, OrderPlacementController],
  providers: [PaymentsService, RefundsService],
  exports: [PaymentsService, RefundsService],
})
export class PaymentsModule {}
