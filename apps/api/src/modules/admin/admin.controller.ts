import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@bokku/database';
import type {
  AdminAuditLog,
  AdminDashboardSummary,
  AdminStoreRow,
  Paginated,
  PublicOrderDetail,
  PublicOrderSummary,
  PublicUser,
} from '@bokku/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminService } from './admin.service';
// NOTE: value imports — the ValidationPipe needs runtime classes for @Query()/@Body() metatypes.
import {
  ListAdminAuditLogsQuery,
  ListAdminOrdersQuery,
  ListAdminUsersQuery,
  UpdateAdminUserRoleDto,
  UpdateAdminUserStatusDto,
} from './dto/admin.dto';

/**
 * Platform admin API (Phase 10). PLATFORM_ADMIN only — the global
 * JwtAuthGuard authenticates and the global RolesGuard enforces the role,
 * so there is no store-membership concept here (cross-store by design).
 * Reads are oversight; mutations (user role/status) are audited.
 */
@ApiTags('Platform Admin')
@ApiBearerAuth('access-token')
@Roles('PLATFORM_ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Platform-wide dashboard',
    description:
      'Cross-store aggregate: orders/revenue (UTC today + all time, revenue = collected ' +
      'and not cancelled/refunded), orders & deliveries by status, users by role, store totals.',
  })
  @ApiOkResponse({ description: 'Platform summary' })
  dashboard(): Promise<AdminDashboardSummary> {
    return this.admin.getDashboard();
  }

  // ── Users ───────────────────────────────────────────────────────

  @Get('users')
  @ApiOperation({
    summary: 'List users (paginated, filterable)',
    description:
      'Soft-deleted accounts are excluded. Filters: role, status, q (case-insensitive ' +
      'email/name search, ILIKE metacharacters escaped).',
  })
  listUsers(@Query() query: ListAdminUsersQuery): Promise<Paginated<PublicUser>> {
    return this.admin.listUsers(query);
  }

  @Patch('users/:id/role')
  @ApiOperation({
    summary: 'Change a user’s role',
    description:
      'Audited. 409 ADMIN_SELF_MODIFICATION on your own account; 409 ADMIN_LAST_PLATFORM_ADMIN ' +
      'when this would demote the last active platform admin. Promotions to staff roles create ' +
      'BOKKU store membership; demotion away from staff removes it.',
  })
  updateUserRole(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminUserRoleDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<PublicUser> {
    return this.admin.updateUserRole(actor, id, dto, { ip, userAgent });
  }

  @Patch('users/:id/status')
  @ApiOperation({
    summary: 'Suspend or reactivate a user',
    description:
      'Audited. Suspension takes effect on the user’s very next request (the JWT guard ' +
      're-checks account status per request). Same 409 protections as role changes.',
  })
  updateUserStatus(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminUserStatusDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<PublicUser> {
    return this.admin.updateUserStatus(actor, id, dto, { ip, userAgent });
  }

  // ── Stores / orders / audit (read-only oversight) ───────────────

  @Get('stores')
  @ApiOperation({
    summary: 'List stores with staff/product counts and today’s numbers',
  })
  listStores(): Promise<AdminStoreRow[]> {
    return this.admin.listStores();
  }

  @Get('orders')
  @ApiOperation({
    summary: 'List orders across all stores',
    description: 'Read-only oversight. Filters: status, storeId. Fulfillment stays in /bokku.',
  })
  listOrders(@Query() query: ListAdminOrdersQuery): Promise<Paginated<PublicOrderSummary>> {
    return this.admin.listOrders(query);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Order detail for any store (404 when unknown)' })
  getOrder(@Param('id', ParseUUIDPipe) id: string): Promise<PublicOrderDetail> {
    return this.admin.getOrder(id);
  }

  @Get('audit-logs')
  @ApiOperation({
    summary: 'Query the audit trail',
    description:
      'Newest first. Filters: action (prefix — "order" matches order.*), actorId, from/to ' +
      '(ISO 8601, inclusive). Joins the acting user for display.',
  })
  listAuditLogs(@Query() query: ListAdminAuditLogsQuery): Promise<Paginated<AdminAuditLog>> {
    return this.admin.listAuditLogs(query);
  }
}
