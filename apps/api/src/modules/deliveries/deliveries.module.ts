import { Module } from '@nestjs/common';

import { DeliveryModule } from '../../integrations/delivery/delivery.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';

/**
 * Deliveries orchestration: the only module that sees both OrdersService
 * and the DeliveryProvider interface (spec: no direct order→vendor access).
 */
@Module({
  imports: [DeliveryModule, OrdersModule, NotificationsModule],
  controllers: [DeliveriesController],
  providers: [DeliveriesService],
  exports: [DeliveriesService],
})
export class DeliveriesModule {}
