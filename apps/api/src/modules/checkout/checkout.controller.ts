import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CheckoutPreview } from '@bokku/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CheckoutService } from './checkout.service';
import { PreviewCheckoutDto } from './dto/checkout.dto';

/**
 * Checkout (authenticated users). Preview is the authoritative price check
 * before payment: the client submits only WHICH cart + WHICH address —
 * never amounts.
 */
@ApiTags('Checkout')
@ApiBearerAuth('access-token')
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post('preview')
  @ApiOperation({
    summary: 'Preview order pricing',
    description:
      'Server-computed breakdown: subtotal + delivery fee (provider quote) + service fee + VAT − ' +
      'discount. Validates the cart is non-empty, every line is still available, and the address ' +
      'belongs to the caller. Idempotent and safe to re-call before paying.',
  })
  @ApiOkResponse({ description: 'Full pricing breakdown + delivery quote' })
  preview(
    @CurrentUser('id') userId: string,
    @Body() dto: PreviewCheckoutDto,
  ): Promise<CheckoutPreview> {
    return this.checkout.preview(userId, dto);
  }
}
