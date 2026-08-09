import { Body, Controller, Get, Headers, HttpCode, Ip, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { User } from '@bokku/database';
import type { PublicUser } from '@bokku/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService, type RequestMeta } from './auth.service';
import {
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  RefreshTokenDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private meta(ip?: string, userAgent?: string): RequestMeta {
    return { ip, userAgent };
  }

  @Public()
  @Post('register')
  @ApiOperation({
    summary: 'Create a customer account',
    description:
      'Registers a CUSTOMER account and returns the user plus an access/refresh token pair. ' +
      'An email verification token is generated (delivered via email once notifications ship; ' +
      'surfaced under `debug` outside production). Role assignment is server-side only.',
  })
  @ApiCreatedResponse({ description: 'Account created; returns { user, tokens }' })
  register(@Body() dto: RegisterDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.auth.register(dto, this.meta(ip, userAgent));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiOkResponse({ description: 'Returns { user, tokens }' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  login(@Body() dto: LoginDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.auth.login(dto, this.meta(ip, userAgent));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rotate a refresh token',
    description:
      'Exchanges a valid refresh token for a new access/refresh pair. The presented token ' +
      'is revoked immediately (rotation). Presenting an already-revoked token revokes the ' +
      'entire session chain (theft detection).',
  })
  @ApiOkResponse({ description: 'New token pair' })
  refresh(
    @Body() dto: RefreshTokenDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.auth.refresh(dto.refreshToken, this.meta(ip, userAgent));
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Revoke a refresh token',
    description: 'Idempotent — succeeds even for unknown or already-revoked tokens.',
  })
  logout(@Body() dto: LogoutDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.auth.logout(dto.refreshToken, this.meta(ip, userAgent));
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Request a password reset',
    description:
      'Always returns the same message regardless of whether the account exists (no user enumeration).',
  })
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.auth.forgotPassword(dto.email, this.meta(ip, userAgent));
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reset password with a token',
    description: 'Sets a new password and revokes all active sessions for the account.',
  })
  resetPassword(
    @Body() dto: ResetPasswordDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.auth.resetPassword(dto.token, dto.password, this.meta(ip, userAgent));
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify email address with a token' })
  verifyEmail(
    @Body() dto: VerifyEmailDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.auth.verifyEmail(dto.token, this.meta(ip, userAgent));
  }

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Current authenticated user' })
  @ApiOkResponse({ description: 'The authenticated user profile' })
  me(@CurrentUser() user: User): PublicUser {
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
