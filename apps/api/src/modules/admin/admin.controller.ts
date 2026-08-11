import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@bokku/database';
import type { AdminAuditLog, AdminDashboardSummary, AdminStoreRow, Paginated, PublicOrderDetail, PublicOrderSummary, PublicUser } from '@bokku/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminService } from './admin.service';
import { RefundsService } from '../payments/refunds.service';
import {
  ListAdminAuditLogsQuery,
  ListAdminOrdersQuery,
  ListAdminUsersQuery,
  UpdateAdminStoreStatusDto,
  UpdateAdminUserRoleDto,
  UpdateAdminUserStatusDto,
} from './dto/admin.dto';

@ApiTags('Platform Admin')
@ApiBearerAuth('access-token')
@Roles('PLATFORM_ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly refunds: RefundsService,
  ) {}

  @Get('dashboard') dashboard(): Promise<AdminDashboardSummary> { return this.admin.getDashboard(); }

  @Get('users') listUsers(@Query() query: ListAdminUsersQuery): Promise<Paginated<PublicUser>> { return this.admin.listUsers(query); }

  @Patch('users/:id/role')
  updateUserRole(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAdminUserRoleDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string): Promise<PublicUser> {
    return this.admin.updateUserRole(actor, id, dto, { ip, userAgent });
  }

  @Patch('users/:id/status')
  updateUserStatus(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAdminUserStatusDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string): Promise<PublicUser> {
    return this.admin.updateUserStatus(actor, id, dto, { ip, userAgent });
  }

  @Get('stores') listStores(): Promise<AdminStoreRow[]> { return this.admin.listStores(); }

  @Patch('stores/:id/status')
  updateStoreStatus(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAdminStoreStatusDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string): Promise<AdminStoreRow> {
    return this.admin.updateStoreStatus(actor, id, dto, { ip, userAgent });
  }

  @Get('orders') listOrders(@Query() query: ListAdminOrdersQuery): Promise<Paginated<PublicOrderSummary>> { return this.admin.listOrders(query); }
  @Get('orders/:id') getOrder(@Param('id', ParseUUIDPipe) id: string): Promise<PublicOrderDetail> { return this.admin.getOrder(id); }

  @Post('orders/:id/retry-refund')
  @ApiOperation({ summary: 'Retry the provider refund for a REFUND_PENDING order' })
  @ApiOkResponse({ description: 'The order remains REFUND_PENDING until the provider emits refund.processed' })
  retryRefund(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string, @Headers('user-agent') userAgent?: string): Promise<PublicOrderDetail> {
    return this.refunds.retryOrderRefund(actor, id, { ip, userAgent });
  }

  @Get('audit-logs') listAuditLogs(@Query() query: ListAdminAuditLogsQuery): Promise<Paginated<AdminAuditLog>> { return this.admin.listAuditLogs(query); }
}
