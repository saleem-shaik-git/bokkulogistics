import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Store, User } from '@bokku/database';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { PaginationQuery } from '../../common/pagination';
import { AuditService } from '../audit/audit.module';
import { InventoryService } from '../inventory/inventory.service';
// NOTE: value import — the ValidationPipe needs the runtime class for @Query()@Body() metatypes.
import { ListOrdersQuery, TransitionOrderStatusDto } from '../orders/dto/orders.dto';
import { BokkuService } from './bokku.service';
import { AdjustInventoryDto, CreateProductDto, UpdateProductDto } from './dto/bokku.dto';
import { CurrentStore, StoreStaffGuard } from './guards/store-staff.guard';

/**
 * Bokku operations API — catalogue & inventory management for store staff.
 * Role gate: STORE_MANAGER / BOKKU_ADMIN / PLATFORM_ADMIN.
 * Resource gate: StoreStaffGuard (store_staff membership; rule 9).
 */
@ApiTags('Bokku Operations')
@ApiBearerAuth('access-token')
@UseGuards(StoreStaffGuard)
@Roles('STORE_MANAGER', 'BOKKU_ADMIN', 'PLATFORM_ADMIN')
@Controller('bokku')
export class BokkuCatalogueController {
  constructor(
    private readonly bokku: BokkuService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  // ── Products ────────────────────────────────────────────────────
  @Get('products')
  @ApiOperation({ summary: 'List this store’s products (all statuses)' })
  listProducts(@CurrentStore() store: Store, @Query() query: PaginationQuery) {
    return this.bokku.listProducts(store, query);
  }

  @Post('products')
  @ApiOperation({
    summary: 'Create a product',
    description: 'Auto-generates slug/SKU when omitted; creates the inventory row atomically.',
  })
  createProduct(
    @CurrentStore() store: Store,
    @CurrentUser() actor: User,
    @Body() dto: CreateProductDto,
  ) {
    return this.bokku.createProduct(store, dto, actor);
  }

  @Patch('products/:id')
  @ApiOperation({
    summary: 'Update a product',
    description: 'Price and status changes are written to the audit log.',
  })
  updateProduct(
    @CurrentStore() store: Store,
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.bokku.updateProduct(store, id, dto, actor);
  }

  // ── Dashboard (Phase 8) ─────────────────────────────────────────
  @Get('dashboard')
  @ApiOperation({
    summary: 'Ops overview for the store',
    description:
      'Headline numbers for the dashboard: today’s orders/revenue (UTC day, revenue is ' +
      'collected-and-not-refunded), pending fulfillment, per-status counts and low-stock alerts.',
  })
  dashboard(@CurrentStore() store: Store) {
    return this.bokku.getDashboard(store);
  }

  // ── Orders (Phase 7) ────────────────────────────────────────────
  @Get('orders')
  @ApiOperation({
    summary: 'List this store’s orders',
    description: 'Optional ?status= filter (12-state machine); paginated newest first.',
  })
  listOrders(@CurrentStore() store: Store, @Query() query: ListOrdersQuery) {
    return this.bokku.listOrders(store, query);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Order detail (store-scoped — cross-store ids are 404)' })
  getOrder(@CurrentStore() store: Store, @Param('id', ParseUUIDPipe) id: string) {
    return this.bokku.getOrder(store, id);
  }

  @Patch('orders/:id/status')
  @ApiOperation({
    summary: 'Transition an order (state-policy validated)',
    description:
      'Staff edges: PAID→CONFIRMED, CONFIRMED→PREPARING, PREPARING→READY_FOR_PICKUP and ' +
      'cancellation. Cancel also runs the refund path: stock released, then ' +
      'CANCELLED→REFUND_PENDING→REFUNDED as the provider refund lands. Any other edge ' +
      'returns 409 ORDER_INVALID_TRANSITION.',
  })
  transitionOrder(
    @CurrentStore() store: Store,
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionOrderStatusDto,
  ) {
    return this.bokku.transitionOrder(store, id, dto, actor);
  }

  // ── Inventory ───────────────────────────────────────────────────
  @Get('inventory')
  @ApiOperation({
    summary: 'Stock levels for the store',
    description: 'On hand / reserved / sellable per product with low-stock flags.',
  })
  listInventory(@CurrentStore() store: Store) {
    return this.inventory.listForStore(store.id);
  }

  @Patch('inventory/:productId')
  @ApiOperation({
    summary: 'Adjust stock for a product',
    description:
      'Signed delta or absolute set, guarded by a row lock — stock can never go negative. ' +
      'Every adjustment is audited with its reason.',
  })
  @ApiOkResponse({ description: 'Updated stock level' })
  async adjustInventory(
    @CurrentStore() store: Store,
    @CurrentUser() actor: User,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: AdjustInventoryDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    const result = await this.inventory.adjust(productId, dto);
    await this.audit.record({
      actorUserId: actor.id,
      action: 'inventory.adjusted',
      entityType: 'product',
      entityId: productId,
      metadata: {
        storeId: store.id,
        before: result.previousQuantityOnHand,
        after: result.quantityOnHand,
        reason: dto.reason,
      },
      ipAddress: ip,
      userAgent,
    });
    return result;
  }
}
