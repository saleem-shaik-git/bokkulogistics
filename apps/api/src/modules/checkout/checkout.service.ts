import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { stores, type DatabaseConnection } from '@bokku/database';
import type { CheckoutPreview } from '@bokku/shared';

import { DELIVERY_PROVIDER, DRIZZLE_CLIENT } from '../../config/constants';
import type { DeliveryProvider, DeliveryQuote } from '../../integrations/delivery/delivery-provider.interface';
import { AddressesService } from '../addresses/addresses.service';
import { CartService } from '../cart/cart.service';
import { PricingService } from '../pricing/pricing.service';
import type { PreviewCheckoutDto } from './dto/checkout.dto';

@Injectable()
export class CheckoutService {
  constructor(
    @Inject(DRIZZLE_CLIENT) private readonly database: DatabaseConnection,
    private readonly cartService: CartService,
    private readonly addressesService: AddressesService,
    private readonly pricing: PricingService,
    @Inject(DELIVERY_PROVIDER) private readonly delivery: DeliveryProvider,
  ) {}

  async preview(userId: string, dto: PreviewCheckoutDto): Promise<CheckoutPreview> {
    const cart = await this.cartService.getCart(userId);
    if (!cart.id || cart.items.length === 0) {
      throw new BadRequestException({ code: 'CART_EMPTY', message: 'Your cart is empty' });
    }

    const unavailable = cart.items.filter((line) => !line.available);
    if (unavailable.length > 0) {
      const names = unavailable
        .slice(0, 3)
        .map((line) => line.name)
        .join(', ');
      throw new ConflictException({
        code: 'CART_ITEMS_UNAVAILABLE',
        message: `Some items are no longer available in the requested quantities: ${names}`,
      });
    }

    const address = this.addressesService.toPublicAddress(
      await this.addressesService.findOwned(userId, dto.addressId),
    );

    // Delivery checkout requires an exact drop-off point. Saving an address
    // without coordinates remains supported for profile/address-book use,
    // but it cannot be used for a delivery quote until a map location is set.
    if (address.latitude === null || address.longitude === null) {
      throw new BadRequestException({
        code: 'DELIVERY_COORDINATES_REQUIRED',
        message: 'Please add a map location (latitude and longitude) to this delivery address',
      });
    }

    const [store] = await this.database.db
      .select({
        latitude: stores.latitude,
        longitude: stores.longitude,
        status: stores.status,
      })
      .from(stores)
      .where(eq(stores.id, cart.storeId!))
      .limit(1);
    if (!store) {
      throw new InternalServerErrorException('Cart store no longer exists');
    }
    if (store.status !== 'ACTIVE') {
      throw new ConflictException({
        code: 'STORE_INACTIVE',
        message: 'This store is temporarily unavailable — please try again later',
      });
    }
    if (store.latitude === null || store.longitude === null) {
      throw new ConflictException({
        code: 'STORE_LOCATION_UNAVAILABLE',
        message: 'This store is not configured with a delivery location',
      });
    }

    const quote = await this.getValidQuote({
      pickup: {
        latitude: Number(store.latitude),
        longitude: Number(store.longitude),
      },
      dropoff: { latitude: address.latitude, longitude: address.longitude },
    });

    const breakdown = this.pricing.computeBreakdown({
      subtotal: cart.subtotal,
      deliveryFee: quote.fee,
      discount: 0,
    });

    return {
      cartId: cart.id,
      storeId: cart.storeId!,
      address,
      lines: cart.items.map((line) => ({
        productId: line.productId,
        name: line.name,
        slug: line.slug,
        sku: line.sku,
        imageUrl: line.imageUrl,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        lineTotal: line.lineTotal,
      })),
      ...breakdown,
      quote: {
        quoteId: quote.quoteId,
        provider: quote.provider,
        fee: quote.fee,
        estimatedMinutes: quote.estimatedMinutes,
        distanceKm: quote.distanceKm,
        expiresAt: quote.expiresAt,
      },
    };
  }

  /**
   * Providers may return a quote that is already expired (or expires during
   * a slow response). Never expose such a quote as payable checkout state.
   * Re-quoting once keeps transient expiry from becoming a false checkout
   * failure while preventing stale delivery pricing from reaching payment.
   */
  private async getValidQuote(input: Parameters<DeliveryProvider['getQuote']>[0]): Promise<DeliveryQuote> {
    let quote = await this.delivery.getQuote(input);
    if (!this.isQuoteExpired(quote)) return quote;

    quote = await this.delivery.getQuote(input);
    if (this.isQuoteExpired(quote)) {
      throw new ConflictException({
        code: 'DELIVERY_QUOTE_EXPIRED',
        message: 'The delivery quote expired before checkout could be completed. Please try again.',
      });
    }
    return quote;
  }

  private isQuoteExpired(quote: DeliveryQuote): boolean {
    const expiresAt = Date.parse(quote.expiresAt);
    return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
  }
}
