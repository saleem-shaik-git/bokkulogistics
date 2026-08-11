import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ORDER_STATUSES } from '@bokku/shared';

export class CreateOrderDto {
  @ApiProperty({
    description: 'Reference of the settled payment paying for this cart (idempotency anchor)',
    example: 'bokku_pay_9f1c2e7a4b3d4e5f8a0c1d2e3f4a5b6c',
  })
  @IsString()
  @Matches(/^bokku_pay_[0-9a-f]{32}$/, { message: 'paymentReference must be a Bokku reference' })
  paymentReference!: string;
}

export class TransitionOrderStatusDto {
  @ApiProperty({ enum: ORDER_STATUSES })
  @IsString()
  @IsIn(ORDER_STATUSES as readonly string[])
  status!: (typeof ORDER_STATUSES)[number];

  @ApiProperty({ required: false, description: 'Required for cancellations' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ListOrdersQuery {
  @ApiProperty({ required: false, enum: ORDER_STATUSES })
  @IsOptional()
  @IsString()
  @IsIn(ORDER_STATUSES as readonly string[])
  status?: string;

  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;
}
