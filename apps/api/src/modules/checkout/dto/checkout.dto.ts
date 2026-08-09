import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class PreviewCheckoutDto {
  @ApiProperty({ description: 'Saved address id to deliver to', format: 'uuid' })
  @IsUUID('4', { message: 'addressId must be a valid UUID' })
  addressId!: string;
}
