import { Module } from '@nestjs/common';

import { DELIVERY_PROVIDER } from '../../config/constants';
import { DeliveryProviderFactory } from './delivery-provider.factory';
import type { DeliveryProvider } from './delivery-provider.interface';

/**
 * Wires the configured DeliveryProvider implementation under the
 * DELIVERY_PROVIDER token. Consumers inject the interface, never a vendor.
 */
@Module({
  providers: [
    DeliveryProviderFactory,
    {
      provide: DELIVERY_PROVIDER,
      useFactory: (factory: DeliveryProviderFactory): DeliveryProvider => factory.create(),
      inject: [DeliveryProviderFactory],
    },
  ],
  exports: [DELIVERY_PROVIDER],
})
export class DeliveryModule {}
