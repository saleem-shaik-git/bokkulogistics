import { Module } from '@nestjs/common';

import { PaymentsIntegrationModule } from '../../integrations/payments/payments.integration.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [PaymentsIntegrationModule, CheckoutModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
