import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PublicCart } from '@bokku/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CartService } from './cart.service';
import { AddCartItemDto, UpdateCartItemDto } from './dto/cart.dto';

/**
 * Customer cart (any authenticated user; the JWT guard is global).
 * Single-store, server-priced: DTOs carry no price fields and the global
 * validation pipe rejects any smuggled extras (business rule 1).
 */
@ApiTags('Cart')
@ApiBearerAuth('access-token')
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @ApiOperation({
    summary: 'Get the current cart',
    description: 'Returns an empty cart when the user has never added an item.',
  })
  @ApiOkResponse({ description: 'Cart with live prices, stock and computed totals' })
  getCart(@CurrentUser('id') userId: string): Promise<PublicCart> {
    return this.cart.getCart(userId);
  }

  @Post('items')
  @ApiOperation({
    summary: 'Add a product to the cart',
    description:
      'Re-adding the same product merges quantities atomically. Validates that the product is ' +
      'available and sellable stock covers the total quantity. Creates the cart on first add; ' +
      'rejects products from a different store (single-store carts).',
  })
  addItem(@CurrentUser('id') userId: string, @Body() dto: AddCartItemDto): Promise<PublicCart> {
    return this.cart.addItem(userId, dto);
  }

  @Patch('items/:itemId')
  @ApiOperation({
    summary: 'Set the quantity of a cart line',
    description: 'The line must belong to the caller; stock is re-validated.',
  })
  updateItem(
    @CurrentUser('id') userId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateCartItemDto,
  ): Promise<PublicCart> {
    return this.cart.updateItem(userId, itemId, dto);
  }

  @Delete('items/:itemId')
  @ApiOperation({ summary: 'Remove a line from the cart' })
  removeItem(
    @CurrentUser('id') userId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<PublicCart> {
    return this.cart.removeItem(userId, itemId);
  }

  @Delete()
  @ApiOperation({ summary: 'Empty the cart', description: 'Idempotent — always succeeds.' })
  clearCart(@CurrentUser('id') userId: string): Promise<{ cleared: boolean }> {
    return this.cart.clearCart(userId);
  }
}
