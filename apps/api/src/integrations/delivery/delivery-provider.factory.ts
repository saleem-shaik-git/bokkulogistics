import { Inject, Injectable } from '@nestjs/common';
import type { EnvConfig } from '@bokku/config';

import { ENV_CONFIG } from '../../config/constants';
import { DeliveryIntegrationError, type DeliveryProvider } from './delivery-provider.interface';
import { MockDeliveryProvider } from './mock-delivery.provider';

/**
 * DeliveryProviderFactory — the ONLY place a concrete provider is chosen
 * (env DELIVERY_DEFAULT_PROVIDER, default MOCK). Orders/checkout depend on
 * the DeliveryProvider interface, never on a vendor.
 *
 * UBER/BOLT fail fast with a clear error until their adapters land in
 * Phase 9 with real credentials — we never fake external vendor behavior.
 */
@Injectable()
export class DeliveryProviderFactory {
  constructor(@Inject(ENV_CONFIG) private readonly env: EnvConfig) {}

  create(): DeliveryProvider {
    switch (this.env.DELIVERY_DEFAULT_PROVIDER) {
      case 'MOCK':
        return new MockDeliveryProvider();
      case 'UBER':
        throw new DeliveryIntegrationError(
          'DELIVERY_PROVIDER_NOT_CONFIGURED',
          'UBER delivery adapter is not available yet (Phase 9). Use DELIVERY_DEFAULT_PROVIDER=MOCK.',
        );
      case 'BOLT':
        throw new DeliveryIntegrationError(
          'DELIVERY_PROVIDER_NOT_CONFIGURED',
          'BOLT delivery adapter is not available yet (Phase 9). Use DELIVERY_DEFAULT_PROVIDER=MOCK.',
        );
      default:
        throw new DeliveryIntegrationError(
          'DELIVERY_PROVIDER_UNKNOWN',
          `Unknown delivery provider: ${String(this.env.DELIVERY_DEFAULT_PROVIDER)}`,
        );
    }
  }
}
