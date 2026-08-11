import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'amara@example.com' })
  @IsEmail({}, { message: 'Enter a valid email address' })
  email!: string;

  @ApiProperty({ example: '+2348012345678', required: false })
  @IsOptional()
  @Matches(/^[+0-9][0-9\s-]*$/, { message: 'Invalid phone number' })
  @MinLength(7)
  @MaxLength(20)
  phone?: string;

  @ApiProperty({ example: 'Passw0rd!23', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(72, { message: 'Password must be at most 72 characters' })
  @Matches(/[a-zA-Z]/, { message: 'Password must contain at least one letter' })
  @Matches(/[0-9]/, { message: 'Password must contain at least one number' })
  password!: string;

  @ApiProperty({ example: 'Amara' })
  @IsString()
  @IsNotEmpty({ message: 'First name is required' })
  @MaxLength(80)
  firstName!: string;

  @ApiProperty({ example: 'Okafor' })
  @IsString()
  @IsNotEmpty({ message: 'Last name is required' })
  @MaxLength(80)
  lastName!: string;
}

export class LoginDto {
  @ApiProperty({ example: 'amara@example.com' })
  @IsEmail({}, { message: 'Enter a valid email address' })
  email!: string;

  @ApiProperty({ example: 'Passw0rd!23' })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  password!: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token issued at login/register' })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class LogoutDto {
  @ApiProperty({ description: 'Refresh token to revoke' })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'amara@example.com' })
  @IsEmail({}, { message: 'Enter a valid email address' })
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token from the reset email (or dev response)' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ example: 'N3wPassw0rd!', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(72, { message: 'Password must be at most 72 characters' })
  @Matches(/[a-zA-Z]/, { message: 'Password must contain at least one letter' })
  @Matches(/[0-9]/, { message: 'Password must contain at least one number' })
  password!: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'Token from the verification email (or dev response)' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}
