import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsDateString, IsIn, IsOptional } from 'class-validator';
import { type AuthedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { AnalyticsService } from './analytics.service.js';

class AnalyticsQuery {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  // What counts as "delivered" for lead time. Definitions shouldn't be mixed
  // when comparing reports.
  @IsOptional()
  @IsIn(['done', 'merged'])
  definition?: 'done' | 'merged';
}

@UseGuards(JwtAuthGuard)
@Controller('projects')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get(':id/analytics')
  get(
    @Req() req: AuthedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: AnalyticsQuery,
  ) {
    return this.analytics.forProject(req.user.id, id, query);
  }
}
