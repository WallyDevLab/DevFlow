import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { type AuthedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import {
  CreateStatusDto,
  DeleteStatusQuery,
  ReorderStatusesDto,
  UpdateStatusDto,
} from './workflow.dto.js';
import { WorkflowService } from './workflow.service.js';

const uuid = () => new ParseUUIDPipe();

@UseGuards(JwtAuthGuard)
@Controller()
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

  @Post('projects/:id/statuses')
  create(
    @Req() req: AuthedRequest,
    @Param('id', uuid()) id: string,
    @Body() dto: CreateStatusDto,
  ) {
    return this.workflow.create(req.user.id, id, dto);
  }

  @Put('projects/:id/statuses/order')
  @HttpCode(204)
  reorder(
    @Req() req: AuthedRequest,
    @Param('id', uuid()) id: string,
    @Body() dto: ReorderStatusesDto,
  ) {
    return this.workflow.reorder(req.user.id, id, dto.ids);
  }

  @Patch('statuses/:id')
  update(
    @Req() req: AuthedRequest,
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.workflow.update(req.user.id, id, dto);
  }

  @Delete('statuses/:id')
  remove(
    @Req() req: AuthedRequest,
    @Param('id', uuid()) id: string,
    @Query() q: DeleteStatusQuery,
  ) {
    return this.workflow.remove(req.user.id, id, q.moveTo);
  }
}
