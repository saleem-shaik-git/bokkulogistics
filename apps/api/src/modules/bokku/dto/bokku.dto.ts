import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ example: 'Indomie Chicken Flavour 70g' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @ApiProperty({ description: 'Category id within the store' })
  @IsUUID('4', { message: 'categoryId must be a valid UUID' })
  categoryId!: string;

  @ApiProperty({ example: 'Instant noodles, single pack', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: 35000, description: 'Price in kobo (integer minor units)' })
  @Type(() => Number)
  @IsInt({ message: 'Price must be an integer number of kobo' })
  @Min(0)
  @Max(100_000_000)
  price!: number;

  @ApiProperty({
    example: 'IND-CHK-70G',
    required: false,
    description: 'SKU (auto-generated when omitted)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sku?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'imageUrl must be a URL' })
  imageUrl?: string;

  @ApiProperty({ example: 50, required: false, description: 'Initial on-hand stock' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  initialStock?: number;

  @ApiProperty({ example: 5, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @ApiProperty({
    example: 'ACTIVE',
    required: false,
    enum: ['ACTIVE', 'INACTIVE', 'OUT_OF_STOCK', 'DRAFT'],
    description: 'Defaults to ACTIVE',
  })
  @IsOptional()
  @IsString()
  status?: 'ACTIVE' | 'INACTIVE' | 'OUT_OF_STOCK' | 'DRAFT';
}

export class UpdateProductDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID('4', { message: 'categoryId must be a valid UUID' })
  categoryId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ required: false, description: 'Price in kobo (integer minor units)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  price?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl({ require_tld: false })
  imageUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @ApiProperty({
    required: false,
    enum: ['ACTIVE', 'INACTIVE', 'OUT_OF_STOCK', 'DRAFT'],
  })
  @IsOptional()
  @IsString()
  status?: 'ACTIVE' | 'INACTIVE' | 'OUT_OF_STOCK' | 'DRAFT';
}

export class AdjustInventoryDto {
  @ApiProperty({ example: 24, required: false, description: 'Signed delta (may be negative)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  adjustment?: number;

  @ApiProperty({ example: 100, required: false, description: 'Absolute on-hand value' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  setQuantity?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @ApiProperty({ example: 'Weekly restock from supplier' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
