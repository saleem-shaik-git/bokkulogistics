import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Store, User } from '@bokku/database';
import type { PublicDeliveryTracking } from '@bokku/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentStore, StoreStaffGuard } from '../bokku/guards/store-staff.guard';
import { OrdersService } from '../orders/orders.service';
import { DeliveriesService } from './deliveries.service';

/**
 * Delivery tracking + dispatch. Every path re-syncs the provider state on
 * read (polling-first) — the progression engine is who is watching.
 */
@ApiTags('Deliveries')
@ApiBearerAuth('access-token')
@Controller()
export class DeliveriesController {
  constructor(
    private readonly deliveries: DeliveriesService,
    private readonly orders: OrdersService,
  ) {}

  @Get('orders/:id/tracking')
  @ApiOperation({
    summary: 'Track my order’s courier',
    description:
      'Owner-scoped (foreign ids → 404). 404 DELIVERY_NOT_FOUND until dispatch. ' +
      'Poll this — each read fast-forwards the courier state with the provider.',
  })
  @ApiOkResponse({ description: 'Current courier state' })
  trackMine(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PublicDeliveryTracking> {
    return this.track(id, { userId });
  }

  @Get('bokku/orders/:id/tracking')
  @UseGuards(StoreStaffGuard)
  @Roles('STORE_MANAGER', 'BOKKU_ADMIN', 'PLATFORM_ADMIN')
  @ApiOperation({
    summary: 'Track a store order’s courier (staff)',
    description: 'Store-scoped via store_staff membership; syncs on read.',
  })
  trackForStore(
    @CurrentStore() store: Store,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PublicDeliveryTracking> {
    return this.track(id, { storeId: store.id });
  }

  @Post('bokku/orders/:id/dispatch')
  @UseGuards(StoreStaffGuard)
  @Roles('STORE_MANAGER', 'BOKKU_ADMIN', 'PLATFORM_ADMIN')
  @ApiOperation({
    summary: 'Dispatch the courier for a ready order (staff)',
    description:
      'Automatic when the order is marked READY_FOR_PICKUP — this endpoint is the explicit ' +
      'retry after a provider hiccup. Idempotent: an existing delivery is returned as-is. ' +
      '409 DELIVERY_NOT_DISPATCHABLE while the order is not READY_FOR_PICKUP.',
  })
  async dispatchForStore(
    @CurrentStore() store: Store,
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PublicDeliveryTracking> {
    const order = await this.orders.getRowById(id);
    if (order.storeId !== store.id) {
      // Store-scoped 404 — never leak another store's order ids.
      return this.notFound();
    }
    await this.deliveries.dispatchForOrder(id, actor);
    return this.track(id, { storeId: store.id });
  }

  private notFound(): never {
    throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order was not found' });
  }

  private async track(
    orderId: string,
    scope: { userId?: string; storeId?: string },
  ): Promise<PublicDeliveryTracking> {
    const order = await this.orders.getRowById(orderId);
    return this.deliveries.trackingForOrder(order, scope);
  }
}
