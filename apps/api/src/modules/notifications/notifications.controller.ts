import { Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: { id: number },
    @Query('unread') unread?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const unreadBool = unread !== undefined ? unread === 'true' || unread === '1' : undefined;
    return this.notifications.list(
      user.id,
      unreadBool,
      cursor ? parseInt(cursor, 10) : undefined,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Post(':id/read')
  @HttpCode(200)
  markAsRead(@CurrentUser() user: { id: number }, @Param('id', ParseIntPipe) id: number) {
    return this.notifications.markAsRead(user.id, id);
  }

  @Post('read-all')
  @HttpCode(200)
  markAllAsRead(@CurrentUser() user: { id: number }) {
    return this.notifications.markAllAsRead(user.id);
  }
}
