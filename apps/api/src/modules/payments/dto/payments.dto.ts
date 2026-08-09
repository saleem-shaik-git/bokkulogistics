import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUrl, IsUUID, Matches } from 'class-validator';

export class InitializePaymentDto {
  @ApiProperty({ description: 'Saved address id to deliver to', format: 'uuid' })
  @IsUUID('4', { message: 'addressId must be a valid UUID' })
  addressId!: string;

  @ApiProperty({
    required: false,
    description: 'Where the provider returns the browser after payment',
    example: 'http://localhost:3000/payment/result',
  })
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  callbackUrl?: string;
}

/** Route-param validation for /payments/:reference (guards junk lookups). */
export class PaymentReferenceParamDto {
  @IsString()
  @Matches(/^bokku_pay_[0-9a-f]{32}$/, { message: 'reference must be a Bokku payment reference' })
  reference!: string;
}

export class MockCompletePaymentDto {
  @ApiProperty({ example: 'bokku_pay_9f1c2e7a4b3d4e5f8a0c1d2e3f4a5b6c' })
  @IsString()
  @Matches(/^bokku_pay_[0-9a-f]{32}$/, { message: 'reference must be a Bokku payment reference' })
  reference!: string;

  @ApiProperty({ enum: ['success', 'failed'] })
  @IsString()
  @IsIn(['success', 'failed'])
  outcome!: 'success' | 'failed';
}
