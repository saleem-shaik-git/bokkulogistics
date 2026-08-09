import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PublicOrderDetail } from '@bokku/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaymentsService } from '../payments/payments.service';
import { CreateOrderDto } from './dto/orders.dto';
import { OrdersService } from './orders.service';

/**
 * Placing an order = converging a settled payment into an order.
 *
 * Registered in PaymentsModule (it orchestrates "re-verify if needed, then
 * convert" across both services without module import cycles) but routed
 * and documented under /orders exactly as the API contract says. Fully
 * idempotent: the payment id is the uniqueness anchor, so retries,
 * refreshes and double-clicks all return the SAME order.
 */
@ApiTags('Orders')
@ApiBearerAuth('access-token')
@Controller('orders')
export class OrderPlacementController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly orders: OrdersService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Place an order for a settled payment',
    description:
      'Requires the payment to be SUCCESS (re-verified on demand when still PENDING). ' +
      'Converting reserves stock atomically; the paid cart is consumed. Another user’s ' +
      'reference and unsettled references return 404/409 respectively.',
  })
  @ApiOkResponse({ description: 'The order (existing one returned on retry)' })
  async place(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateOrderDto,
  ): Promise<PublicOrderDetail> {
    const payment = await this.payments.getSettledRowForUser(userId, dto.paymentReference);
    const { order } = await this.orders.createFromPayment(payment, 'http');
    return this.orders.getMine(userId, order.id);
  }
}
