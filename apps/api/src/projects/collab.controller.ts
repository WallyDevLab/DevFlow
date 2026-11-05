import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { type AuthedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CommentDto, CreateLabelDto, UpdateLabelDto } from './collab.dto.js';
import { CollabService } from './collab.service.js';

const uuid = () => new ParseUUIDPipe();

@UseGuards(JwtAuthGuard)
@Controller()
export class CollabController {
  constructor(private readonly collab: CollabService) {}

  @Get('projects/:id/labels')
  labels(@Req() req: AuthedRequest, @Param('id', uuid()) id: string) {
    return this.collab.listLabels(req.user.id, id);
  }

  @Post('projects/:id/labels')
  createLabel(
    @Req() req: AuthedRequest,
    @Param('id', uuid()) id: string,
    @Body() dto: CreateLabelDto,
  ) {
    return this.collab.createLabel(req.user.id, id, dto.name, dto.color);
  }

  @Patch('labels/:id')
  updateLabel(
    @Req() req: AuthedRequest,
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateLabelDto,
  ) {
    return this.collab.updateLabel(req.user.id, id, dto);
  }

  @Delete('labels/:id')
  @HttpCode(204)
  deleteLabel(@Req() req: AuthedRequest, @Param('id', uuid()) id: string) {
    return this.collab.deleteLabel(req.user.id, id);
  }

  @Get('tasks/:id/comments')
  comments(@Req() req: AuthedRequest, @Param('id', uuid()) id: string) {
    return this.collab.listComments(req.user.id, id);
  }

  @Post('tasks/:id/comments')
  addComment(
    @Req() req: AuthedRequest,
    @Param('id', uuid()) id: string,
    @Body() dto: CommentDto,
  ) {
    return this.collab.addComment(req.user.id, id, dto.body, dto.mentionIds);
  }

  @Patch('comments/:id')
  @HttpCode(204)
  editComment(
    @Req() req: AuthedRequest,
    @Param('id', uuid()) id: string,
    @Body() dto: CommentDto,
  ) {
    return this.collab.editComment(req.user.id, id, dto.body, dto.mentionIds);
  }

  @Delete('comments/:id')
  @HttpCode(204)
  deleteComment(@Req() req: AuthedRequest, @Param('id', uuid()) id: string) {
    return this.collab.deleteComment(req.user.id, id);
  }
}
