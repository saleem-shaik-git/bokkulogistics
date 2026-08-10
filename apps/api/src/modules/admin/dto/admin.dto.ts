import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { EntityStatus, ORDER_STATUSES, UserRole } from '@bokku/shared';

/**
 * NOTE: value imports — the ValidationPipe needs runtime classes/values
 * for @Query()/@Body() metatypes and @IsIn checks.
 */

const USER_ROLE_VALUES = Object.values(UserRole);
const USER_STATUS_VALUES = Object.values(EntityStatus);

export class ListAdminUsersQuery {
  @ApiProperty({ required: false, enum: USER_ROLE_VALUES })
  @IsOptional()
  @IsIn(USER_ROLE_VALUES)
  role?: UserRole;

  @ApiProperty({ required: false, enum: USER_STATUS_VALUES })
  @IsOptional()
  @IsIn(USER_STATUS_VALUES)
  status?: EntityStatus;

  @ApiProperty({
    required: false,
    description: 'Case-insensitive search over email and name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;
}

export class UpdateAdminUserRoleDto {
  @ApiProperty({ enum: USER_ROLE_VALUES })
  @IsIn(USER_ROLE_VALUES)
  role!: UserRole;

  @ApiProperty({ required: false, description: 'Optional audit note' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateAdminUserStatusDto {
  /**
   * INACTIVE is the pre-verification state set by registration — admins
   * only toggle ACTIVE ⇄ SUSPENDED. (Suspended users are rejected by the
   * global JWT guard on their very next request, so suspension is
   * effective immediately.)
   */
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] })
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status!: 'ACTIVE' | 'SUSPENDED';

  @ApiProperty({ required: false, description: 'Optional audit note' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ListAdminOrdersQuery {
  @ApiProperty({ required: false, enum: ORDER_STATUSES })
  @IsOptional()
  @IsString()
  @IsIn(ORDER_STATUSES as readonly string[])
  status?: string;

  @ApiProperty({ required: false, description: 'Filter to one store' })
  @IsOptional()
  @IsUUID('4')
  storeId?: string;

  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;
}

export class ListAdminAuditLogsQuery {
  @ApiProperty({
    required: false,
    description: 'Prefix filter on the dotted action, e.g. "order" or "auth.login"',
    example: 'order',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  action?: string;

  @ApiProperty({ required: false, description: 'Filter by acting user' })
  @IsOptional()
  @IsUUID('4')
  actorId?: string;

  @ApiProperty({ required: false, description: 'ISO 8601 lower bound (inclusive)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiProperty({ required: false, description: 'ISO 8601 upper bound (inclusive)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;
}
