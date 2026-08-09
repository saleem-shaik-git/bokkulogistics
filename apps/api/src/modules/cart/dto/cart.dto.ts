import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';
import { CART_MAX_ITEM_QUANTITY } from '@bokku/shared';

/**
 * NOTE: no price fields exist here on purpose — prices are read from the
 * database only, and the global ValidationPipe (forbidNonWhitelisted)
 * rejects any client-submitted extras.
 */
export class AddCartItemDto {
  @ApiProperty({ description: 'Product to add', format: 'uuid' })
  @IsUUID('4', { message: 'productId must be a valid UUID' })
  productId!: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: CART_MAX_ITEM_QUANTITY })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CART_MAX_ITEM_QUANTITY)
  quantity!: number;
}

export class UpdateCartItemDto {
  @ApiProperty({ example: 3, minimum: 1, maximum: CART_MAX_ITEM_QUANTITY })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CART_MAX_ITEM_QUANTITY)
  quantity!: number;
}
