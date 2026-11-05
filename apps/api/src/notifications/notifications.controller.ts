import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { type AuthedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import {
  NOTIFICATION_KINDS,
  NotificationsService,
} from './notifications.service.js';

class ListQuery {
  @IsOptional()
  @IsIn(['true', 'false'])
  unread?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

class PreferenceDto {
  @IsIn(NOTIFICATION_KINDS.map((k) => k.type))
  type: (typeof NOTIFICATION_KINDS)[number]['type'];

  @IsBoolean()
  inApp: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  list(@Req() req: AuthedRequest, @Query() q: ListQuery) {
    return this.notifications.list(req.user.id, {
      unreadOnly: q.unread === 'true',
      limit: q.limit ?? 30,
    });
  }

  @Get('notifications/unread-count')
  unreadCount(@Req() req: AuthedRequest) {
    return this.notifications.unreadCount(req.user.id);
  }

  @Get('notifications/preferences')
  preferences(@Req() req: AuthedRequest) {
    return this.notifications.preferences(req.user.id);
  }

  @Put('notifications/preferences')
  @HttpCode(204)
  setPreference(@Req() req: AuthedRequest, @Body() dto: PreferenceDto) {
    return this.notifications.setPreference(req.user.id, dto.type, dto.inApp);
  }

  @Post('notifications/read-all')
  @HttpCode(204)
  readAll(@Req() req: AuthedRequest) {
    return this.notifications.markAllRead(req.user.id);
  }

  @Post('notifications/:id/read')
  @HttpCode(204)
  read(
    @Req() req: AuthedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notifications.markRead(req.user.id, id);
  }

  @Get('workspaces/:id/activity')
  activity(
    @Req() req: AuthedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notifications.activityFeed(req.user.id, id);
  }
}
