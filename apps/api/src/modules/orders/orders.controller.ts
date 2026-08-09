import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@bokku/database';
import type { Paginated, PublicOrderDetail, PublicOrderSummary } from '@bokku/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { PaginationQuery } from '../../common/pagination';
import { OrdersService } from './orders.service';

/**
 * Customer order surface. Placing an order lives in PaymentsModule
 * (POST /orders — the payment is the idempotency anchor) so the payments
 * module can orchestrate "settle, then convert" without import cycles.
 */
@ApiTags('Orders')
@ApiBearerAuth('access-token')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'My orders (newest first)' })
  @ApiOkResponse({ description: 'Paginated order summaries' })
  listMine(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQuery,
  ): Promise<Paginated<PublicOrderSummary>> {
    return this.orders.listMine(userId, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One of my orders',
    description: 'Other users’ order ids return 404 (owner-scoped).',
  })
  getMine(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PublicOrderDetail> {
    return this.orders.getMine(userId, id);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancel my order (pre-payment only)',
    description:
      'The state policy only allows customers to cancel while PENDING_PAYMENT — paid orders ' +
      'are cancelled by Bokku staff, who run the refund path.',
  })
  cancelMine(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PublicOrderDetail> {
    return this.orders.cancelMine(user.id, id, user);
  }
}
