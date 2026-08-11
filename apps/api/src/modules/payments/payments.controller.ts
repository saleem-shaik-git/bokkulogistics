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
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import {
  InitializePaymentDto,
  MockCompletePaymentDto,
  PaymentReferenceParamDto,
} from './dto/payments.dto';
import { PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
  ) {}

  @Post('initialize')
  @RateLimit({ bucket: 'sensitive' })
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Initialize a payment for the current cart',
    description:
      'Recomputes the checkout preview server-side and creates (or idempotently reuses) the pending transaction.',
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
  @ApiOperation({ summary: 'Get a payment by reference (owner only)' })
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
    const paymentResult = await this.payments.handlePaystackWebhook(req.rawBody, signature);
    await this.refunds.handlePaystackWebhook(req.rawBody, signature);
    return paymentResult;
  }

  @Public()
  @Post('mock/complete')
  @RateLimit({ bucket: 'sensitive' })
  @ApiExcludeEndpoint()
  mockComplete(@Body() dto: MockCompletePaymentDto): Promise<PaymentSummary> {
    return this.payments.mockComplete(dto);
  }
}
