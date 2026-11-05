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
import { Throttle } from '@nestjs/throttler';
import { type AuthedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import {
  AcceptInvitationDto,
  CreateWorkspaceDto,
  InviteMemberDto,
  UpdateRoleDto,
} from './workspaces.dto.js';
import { WorkspacesService } from './workspaces.service.js';

@UseGuards(JwtAuthGuard)
@Controller()
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Post('workspaces')
  create(@Req() req: AuthedRequest, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(req.user.id, dto.name);
  }

  @Get('workspaces')
  list(@Req() req: AuthedRequest) {
    return this.workspaces.listForUser(req.user.id);
  }

  @Get('workspaces/:id')
  get(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.workspaces.get(req.user.id, id);
  }

  @Get('workspaces/:id/members')
  members(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.workspaces.listMembers(req.user.id, id);
  }

  @Patch('workspaces/:id/members/:userId')
  @HttpCode(204)
  updateRole(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.workspaces.updateRole(req.user.id, id, userId, dto.role);
  }

  @Delete('workspaces/:id/members/:userId')
  @HttpCode(204)
  removeMember(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.workspaces.removeMember(req.user.id, id, userId);
  }

  @Post('workspaces/:id/invitations')
  invite(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InviteMemberDto,
  ) {
    return this.workspaces.invite(req.user.id, id, dto.email, dto.role);
  }

  @Get('workspaces/:id/invitations')
  invitations(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.workspaces.listInvitations(req.user.id, id);
  }

  @Delete('workspaces/:id/invitations/:invitationId')
  @HttpCode(204)
  revoke(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.workspaces.revokeInvitation(req.user.id, id, invitationId);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('invitations/accept')
  @HttpCode(200)
  accept(@Req() req: AuthedRequest, @Body() dto: AcceptInvitationDto) {
    return this.workspaces.acceptInvitation(
      req.user.id,
      req.user.email,
      dto.token,
    );
  }
}
