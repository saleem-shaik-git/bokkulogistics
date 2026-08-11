import { Inject, Injectable } from '@nestjs/common';
import type { EnvConfig } from '@bokku/config';
import type { Redis } from 'ioredis';

import { ENV_CONFIG, REDIS_CLIENT } from '../../config/constants';
import { MockPaymentProvider } from './mock-payment.provider';
import { PaymentIntegrationError, type PaymentProvider } from './payment-provider.interface';
import { PaystackProvider } from './paystack.provider';

/**
 * PaymentProviderFactory — the ONLY place a concrete payment provider is
 * chosen (env PAYMENT_PROVIDER, default MOCK). PAYSTACK without a secret
 * key fails fast at boot instead of at the first customer payment.
 */
@Injectable()
export class PaymentProviderFactory {
  constructor(
    @Inject(ENV_CONFIG) private readonly env: EnvConfig,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  create(): PaymentProvider {
    switch (this.env.PAYMENT_PROVIDER) {
      case 'MOCK':
        return new MockPaymentProvider(this.env, this.redis);
      case 'PAYSTACK':
        if (!this.env.PAYSTACK_SECRET_KEY) {
          throw new PaymentIntegrationError(
            'PAYMENT_PROVIDER_NOT_CONFIGURED',
            'PAYMENT_PROVIDER=PAYSTACK requires PAYSTACK_SECRET_KEY. Use MOCK for development.',
          );
        }
        return new PaystackProvider(this.env);
      default:
        throw new PaymentIntegrationError(
          'PAYMENT_PROVIDER_UNKNOWN',
          `Unknown payment provider: ${String(this.env.PAYMENT_PROVIDER)}`,
        );
    }
  }
}
