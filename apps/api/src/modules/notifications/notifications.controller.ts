import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  NotificationUnreadCount,
  Paginated,
  PublicNotification,
  PublicNotificationPreferences,
} from '@bokku/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
// NOTE: value imports — the ValidationPipe needs runtime classes for @Query()/@Body() metatypes.
import { ListNotificationsQuery, UpdateNotificationPreferencesDto } from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

/**
 * Notification feed + preferences (Phase 11). Every route is owner-
 * scoped — foreign ids 404. The web app polls `unread-count` for the
 * bell badge (polling-first; no websockets in the MVP).
 */
@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'My notification feed (newest first)',
    description: 'Pass ?unread=true for the unread-only slice.',
  })
  @ApiOkResponse({ description: 'Paginated feed' })
  list(
    @CurrentUser('id') userId: string,
    @Query() query: ListNotificationsQuery,
  ): Promise<Paginated<PublicNotification>> {
    return this.notifications.listMine(userId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread count for the bell badge (cheap poll)' })
  unreadCount(@CurrentUser('id') userId: string): Promise<NotificationUnreadCount> {
    return this.notifications.unreadCount(userId);
  }

  @Patch(':id/read')
  @ApiOperation({
    summary: 'Mark one notification read',
    description: 'Idempotent; 404 NOTIFICATION_NOT_FOUND for foreign or unknown ids.',
  })
  markRead(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PublicNotification> {
    return this.notifications.markRead(userId, id);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark every notification read; returns the count touched' })
  markAllRead(@CurrentUser('id') userId: string): Promise<{ updated: number }> {
    return this.notifications.markAllRead(userId);
  }

  @Get('preferences')
  @ApiOperation({
    summary: 'My notification preferences (defaults materialised on first read)',
  })
  getPreferences(@CurrentUser('id') userId: string): Promise<PublicNotificationPreferences> {
    return this.notifications.getPreferences(userId);
  }

  @Patch('preferences')
  @ApiOperation({
    summary: 'Update preference toggles (merge semantics)',
    description:
      'Category flags gate which events land in the feed; emailEnabled/smsEnabled are ' +
      'stored placeholders — no external sends happen in the MVP.',
  })
  updatePreferences(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateNotificationPreferencesDto,
  ): Promise<PublicNotificationPreferences> {
    return this.notifications.updatePreferences(userId, dto);
  }
}
