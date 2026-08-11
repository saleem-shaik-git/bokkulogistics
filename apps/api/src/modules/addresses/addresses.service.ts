import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { addresses, type Address, type DatabaseConnection } from '@bokku/database';
import { ADDRESSES_MAX_PER_USER, type PublicAddress } from '@bokku/shared';

import { DRIZZLE_CLIENT } from '../../config/constants';
import type { CreateAddressDto, UpdateAddressDto } from './dto/addresses.dto';

@Injectable()
export class AddressesService {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly database: DatabaseConnection) {}

  async list(userId: string): Promise<PublicAddress[]> {
    const rows = await this.database.db
      .select()
      .from(addresses)
      .where(eq(addresses.userId, userId))
      .orderBy(desc(addresses.isDefault), desc(addresses.createdAt));
    return rows.map((row) => this.toPublicAddress(row));
  }

  async create(userId: string, dto: CreateAddressDto): Promise<PublicAddress> {
    this.assertCoordinatePair(dto.latitude, dto.longitude);

    return this.database.db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: addresses.id })
        .from(addresses)
        .where(eq(addresses.userId, userId));
      if (existing.length >= ADDRESSES_MAX_PER_USER) {
        throw new ConflictException({
          code: 'ADDRESS_LIMIT_REACHED',
          message: `You can save at most ${ADDRESSES_MAX_PER_USER} addresses`,
        });
      }
      const makeDefault = existing.length === 0 || dto.isDefault === true;
      if (makeDefault && existing.length > 0) {
        await tx
          .update(addresses)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(and(eq(addresses.userId, userId), eq(addresses.isDefault, true)));
      }

      const [created] = await tx
        .insert(addresses)
        .values({
          userId,
          label: dto.label,
          street: dto.street,
          city: dto.city,
          state: dto.state,
          landmark: dto.landmark,
          latitude: dto.latitude === undefined ? null : String(dto.latitude),
          longitude: dto.longitude === undefined ? null : String(dto.longitude),
          isDefault: makeDefault,
        })
        .returning();
      return this.toPublicAddress(created!);
    });
  }

  async update(userId: string, id: string, dto: UpdateAddressDto): Promise<PublicAddress> {
    this.assertCoordinatePair(dto.latitude, dto.longitude);

    return this.database.db.transaction(async (tx) => {
      const owned = await this.findOwned(userId, id, tx);
      const textLocationChanged =
        (dto.street !== undefined && dto.street !== owned.street) ||
        (dto.city !== undefined && dto.city !== owned.city) ||
        (dto.state !== undefined && dto.state !== owned.state);

      // Never leave GPS coordinates pointing at the old physical address.
      // A text-location change must be accompanied by a new coordinate pair.
      if (textLocationChanged && (dto.latitude === undefined || dto.longitude === undefined)) {
        throw new BadRequestException({
          code: 'LOCATION_COORDINATES_REQUIRED',
          message: 'Street, city, or state changes require a new latitude/longitude pair',
        });
      }

      if (dto.isDefault === true && !owned.isDefault) {
        await tx
          .update(addresses)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(and(eq(addresses.userId, userId), eq(addresses.isDefault, true)));
      }

      const updates: Partial<typeof addresses.$inferInsert> = { updatedAt: new Date() };
      if (dto.label !== undefined) updates.label = dto.label;
      if (dto.street !== undefined) updates.street = dto.street;
      if (dto.city !== undefined) updates.city = dto.city;
      if (dto.state !== undefined) updates.state = dto.state;
      if (dto.landmark !== undefined) updates.landmark = dto.landmark;
      if (dto.latitude !== undefined) updates.latitude = String(dto.latitude);
      if (dto.longitude !== undefined) updates.longitude = String(dto.longitude);
      if (dto.isDefault !== undefined) updates.isDefault = dto.isDefault;

      const [updated] = await tx
        .update(addresses)
        .set(updates)
        .where(eq(addresses.id, owned.id))
        .returning();
      return this.toPublicAddress(updated!);
    });
  }

  async remove(userId: string, id: string): Promise<{ deleted: boolean }> {
    await this.database.db.transaction(async (tx) => {
      const owned = await this.findOwned(userId, id, tx);
      await tx.delete(addresses).where(eq(addresses.id, owned.id));

      if (owned.isDefault) {
        const [next] = await tx
          .select()
          .from(addresses)
          .where(eq(addresses.userId, userId))
          .orderBy(desc(addresses.createdAt))
          .limit(1);
        if (next) {
          await tx
            .update(addresses)
            .set({ isDefault: true, updatedAt: new Date() })
            .where(eq(addresses.id, next.id));
        }
      }
    });
    return { deleted: true };
  }

  async findOwned(
    userId: string,
    id: string,
    tx?: Pick<DatabaseConnection['db'], 'select'>,
  ): Promise<Address> {
    const db = tx ?? this.database.db;
    const [row] = await db
      .select()
      .from(addresses)
      .where(and(eq(addresses.id, id), eq(addresses.userId, userId)))
      .limit(1);
    if (!row) {
      throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: 'Address was not found' });
    }
    return row;
  }

  private assertCoordinatePair(latitude?: number, longitude?: number): void {
    const onlyOne = (latitude === undefined) !== (longitude === undefined);
    if (onlyOne) {
      throw new BadRequestException({
        code: 'COORDINATE_PAIR_REQUIRED',
        message: 'Latitude and longitude must be provided together',
      });
    }
  }

  toPublicAddress(row: Address): PublicAddress {
    return {
      id: row.id,
      label: row.label,
      street: row.street,
      city: row.city,
      state: row.state,
      landmark: row.landmark,
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      isDefault: row.isDefault,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
