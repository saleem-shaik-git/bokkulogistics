import { Inject, Injectable } from '@nestjs/common';
import type { EnvConfig } from '@bokku/config';
import type { Redis } from 'ioredis';

import { ENV_CONFIG, REDIS_CLIENT } from '../../config/constants';
import { DeliveryIntegrationError, type DeliveryProvider } from './delivery-provider.interface';
import { MockDeliveryProvider } from './mock-delivery.provider';

/**
 * DeliveryProviderFactory — the ONLY place a concrete provider is chosen
 * (env DELIVERY_DEFAULT_PROVIDER, default MOCK). Orders/checkout depend on
 * the DeliveryProvider interface, never on a vendor.
 *
 * UBER/BOLT fail fast with a clear error until their adapters land with
 * real credentials — we never fake external vendor behavior.
 */
@Injectable()
export class DeliveryProviderFactory {
  constructor(
    @Inject(ENV_CONFIG) private readonly env: EnvConfig,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  create(): DeliveryProvider {
    switch (this.env.DELIVERY_DEFAULT_PROVIDER) {
      case 'MOCK':
        return new MockDeliveryProvider(this.redis);
      case 'UBER':
        throw new DeliveryIntegrationError(
          'DELIVERY_PROVIDER_NOT_CONFIGURED',
          'UBER delivery adapter requires real vendor credentials (not wired). Use DELIVERY_DEFAULT_PROVIDER=MOCK.',
        );
      case 'BOLT':
        throw new DeliveryIntegrationError(
          'DELIVERY_PROVIDER_NOT_CONFIGURED',
          'BOLT delivery adapter requires real vendor credentials (not wired). Use DELIVERY_DEFAULT_PROVIDER=MOCK.',
        );
      default:
        throw new DeliveryIntegrationError(
          'DELIVERY_PROVIDER_UNKNOWN',
          `Unknown delivery provider: ${String(this.env.DELIVERY_DEFAULT_PROVIDER)}`,
        );
    }
  }
}
