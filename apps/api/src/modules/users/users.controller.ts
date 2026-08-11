import { Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { eq } from 'drizzle-orm';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { users, type DatabaseConnection, type User } from '@bokku/database';
import type { PublicUser } from '@bokku/shared';
import { NotFoundException } from '@nestjs/common';

import { DRIZZLE_CLIENT } from '../../config/constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

export class UpdateProfileDto {
  @ApiProperty({ example: 'Amara', required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  firstName?: string;

  @ApiProperty({ example: 'Okafor', required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  lastName?: string;

  @ApiProperty({ example: '+2348012345678', required: false })
  @IsOptional()
  @Matches(/^[+0-9][0-9\s-]*$/, { message: 'Invalid phone number' })
  @MinLength(7)
  @MaxLength(20)
  phone?: string;
}

@ApiTags('Users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly database: DatabaseConnection) {}

  @Get('me')
  @ApiOperation({ summary: 'Get own profile (resource-scoped to the caller)' })
  @ApiOkResponse({ description: 'Own user profile' })
  me(@CurrentUser() user: User): PublicUser {
    return this.toPublic(user);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update own profile',
    description:
      'Only the caller’s own account can be modified — no user id is taken from the URL, ' +
      'which makes cross-account access impossible on this endpoint.',
  })
  @ApiOkResponse({ description: 'Updated profile' })
  async updateMe(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<PublicUser> {
    const patch: Partial<Pick<User, 'firstName' | 'lastName' | 'phone' | 'updatedAt'>> = {
      updatedAt: new Date(),
    };
    if (dto.firstName !== undefined) patch.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) patch.lastName = dto.lastName.trim();
    if (dto.phone !== undefined) patch.phone = dto.phone.trim() || null;

    const [updated] = await this.database.db
      .update(users)
      .set(patch)
      .where(eq(users.id, userId))
      .returning();
    if (!updated) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User was not found' });
    }
    return this.toPublic(updated);
  }

  private toPublic(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
