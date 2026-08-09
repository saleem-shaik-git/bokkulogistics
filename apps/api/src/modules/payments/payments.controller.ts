import { Body, Controller, Get, Headers, Ip, Param, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@bokku/database';
import type { InitializePaymentResult, PaymentSummary } from '@bokku/shared';
import type { Request } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import {
  InitializePaymentDto,
  MockCompletePaymentDto,
  PaymentReferenceParamDto,
} from './dto/payments.dto';
import { PaymentsService } from './payments.service';

/**
 * Payments. Amounts are computed server-side only (checkout preview);
 * confirmation comes only from server-side verification with the provider —
 * the webhook drives it, client redirects never mark anything paid.
 */
@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('initialize')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Initialize a payment for the current cart',
    description:
      'Recomputes the checkout preview server-side and creates (or idempotently reuses) the ' +
      'pending transaction: same cart + same total ⇒ same reference. Cart total changed ⇒ the ' +
      'stale pending row is abandoned and a fresh reference is issued. A paid cart returns ' +
      '409 CART_ALREADY_PAID.',
  })
  @ApiOkResponse({ description: 'Payment + hosted checkout URL to send the browser to' })
  initialize(
    @CurrentUser() user: User,
    @Body() dto: InitializePaymentDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<InitializePaymentResult> {
    return this.payments.initialize(user, dto, { ip, userAgent });
  }

  @Get(':reference')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get a payment by reference (owner only)',
    description:
      'While PENDING, the payment is re-verified server-side with the provider on each read — ' +
      'a safe fallback when the webhook is delayed. Other users’ references return 404.',
  })
  getByReference(
    @CurrentUser('id') userId: string,
    @Param() params: PaymentReferenceParamDto,
  ): Promise<PaymentSummary> {
    return this.payments.getByReferenceForUser(userId, params.reference);
  }

  @Public()
  @Post('webhook/paystack')
  @ApiExcludeEndpoint()
  async paystackWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-paystack-signature') signature?: string,
  ): Promise<{ received: boolean }> {
    return this.payments.handlePaystackWebhook(req.rawBody, signature);
  }

  @Public()
  @Post('mock/complete')
  @ApiExcludeEndpoint()
  mockComplete(@Body() dto: MockCompletePaymentDto): Promise<PaymentSummary> {
    return this.payments.mockComplete(dto);
  }
}
