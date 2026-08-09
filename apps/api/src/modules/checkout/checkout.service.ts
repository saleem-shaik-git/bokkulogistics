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
import type { DeliveryProvider } from '../../integrations/delivery/delivery-provider.interface';
import { AddressesService } from '../addresses/addresses.service';
import { CartService } from '../cart/cart.service';
import { PricingService } from '../pricing/pricing.service';
import type { PreviewCheckoutDto } from './dto/checkout.dto';

/**
 * Checkout preview — the server computes EVERYTHING the user will pay:
 * live cart prices, a delivery fee quote from the configured provider,
 * and the PricingService breakdown. Read-only: previews change no state
 * and can be called repeatedly (safe to refresh before paying).
 */
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

    // Owner-scoped: another user's address id is simply not found (no IDOR).
    const address = this.addressesService.toPublicAddress(
      await this.addressesService.findOwned(userId, dto.addressId),
    );

    const [store] = await this.database.db
      .select({
        latitude: stores.latitude,
        longitude: stores.longitude,
      })
      .from(stores)
      .where(eq(stores.id, cart.storeId!))
      .limit(1);
    if (!store) {
      throw new InternalServerErrorException('Cart store no longer exists');
    }

    const quote = await this.delivery.getQuote({
      pickup: {
        latitude: store.latitude === null ? null : Number(store.latitude),
        longitude: store.longitude === null ? null : Number(store.longitude),
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
}
