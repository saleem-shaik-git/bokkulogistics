import { Module } from '@nestjs/common';

import { PAYMENT_PROVIDER } from '../../config/constants';
import { MockPaymentProvider } from './mock-payment.provider';
import { PaymentProviderFactory } from './payment-provider.factory';
import type { PaymentProvider } from './payment-provider.interface';

/**
 * Wires the configured PaymentProvider under the PAYMENT_PROVIDER token.
 * The mock provider is also exported as its concrete class so the
 * dev/test-only mock checkout endpoint can drive simulateOutcome().
 */
@Module({
  providers: [
    PaymentProviderFactory,
    MockPaymentProvider,
    {
      provide: PAYMENT_PROVIDER,
      useFactory: (factory: PaymentProviderFactory): PaymentProvider => factory.create(),
      inject: [PaymentProviderFactory],
    },
  ],
  exports: [PAYMENT_PROVIDER, MockPaymentProvider],
})
export class PaymentsIntegrationModule {}
