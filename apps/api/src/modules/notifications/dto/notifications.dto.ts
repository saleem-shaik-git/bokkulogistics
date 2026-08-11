import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

// NOTE: value imports — the ValidationPipe needs runtime classes for @Query()/@Body() metatypes.

export class ListNotificationsQuery {
  @ApiProperty({ required: false, description: 'Pass "true" to list unread only' })
  @IsOptional()
  @IsIn(['true'])
  unread?: string;

  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;
}

export class UpdateNotificationPreferencesDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  orderUpdates?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  paymentUpdates?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  deliveryUpdates?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  marketing?: boolean;

  @ApiProperty({ required: false, description: 'Channel placeholder (no sends in the MVP)' })
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @ApiProperty({ required: false, description: 'Channel placeholder (no sends in the MVP)' })
  @IsOptional()
  @IsBoolean()
  smsEnabled?: boolean;
}
