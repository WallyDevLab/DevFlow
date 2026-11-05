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
import {
  CreateProjectDto,
  CreateTaskDto,
  UpdateProjectDto,
  UpdateTaskDto,
} from './projects.dto.js';
import { ProjectsService } from './projects.service.js';
import {
  CompleteSprintDto,
  CreateSprintDto,
  UpdateSprintDto,
} from './sprints.dto.js';
import { SprintsService } from './sprints.service.js';
import { TasksService } from './tasks.service.js';

const uuid = () => new ParseUUIDPipe();

@UseGuards(JwtAuthGuard)
@Controller()
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly tasks: TasksService,
    private readonly sprints: SprintsService,
  ) {}

  @Post('workspaces/:workspaceId/projects')
  createProject(
    @Req() req: AuthedRequest,
    @Param('workspaceId', uuid()) workspaceId: string,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projects.create(req.user.id, workspaceId, dto);
  }

  @Get('workspaces/:workspaceId/projects')
  listProjects(
    @Req() req: AuthedRequest,
    @Param('workspaceId', uuid()) workspaceId: string,
  ) {
    return this.projects.list(req.user.id, workspaceId);
  }

  @Get('projects/:id')
  getProject(@Req() req: AuthedRequest, @Param('id', uuid()) id: string) {
    return this.projects.get(req.user.id, id);
  }

  @Patch('projects/:id')
  updateProject(
    @Req() req: AuthedRequest,
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(req.user.id, id, dto);
  }

  @Get('projects/:id/boards')
  board(@Req() req: AuthedRequest, @Param('id', uuid()) id: string) {
    return this.projects.board(req.user.id, id);
  }

  @Get('projects/:id/backlog')
  backlog(@Req() req: AuthedRequest, @Param('id', uuid()) id: string) {
    return this.sprints.backlog(req.user.id, id);
  }

  @Post('projects/:id/sprints')
  createSprint(
    @Req() req: AuthedRequest,
    @Param('id', uuid()) id: string,
    @Body() dto: CreateSprintDto,
  ) {
    return this.sprints.create(req.user.id, id, dto);
  }

  @Patch('sprints/:id')
  @HttpCode(204)
  updateSprint(
    @Req() req: AuthedRequest,
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateSprintDto,
  ) {
    return this.sprints.update(req.user.id, id, dto);
  }

  @Post('sprints/:id/start')
  @HttpCode(204)
  startSprint(@Req() req: AuthedRequest, @Param('id', uuid()) id: string) {
    return this.sprints.start(req.user.id, id);
  }

  @Post('sprints/:id/complete')
  @HttpCode(204)
  completeSprint(
    @Req() req: AuthedRequest,
    @Param('id', uuid()) id: string,
    @Body() dto: CompleteSprintDto,
  ) {
    return this.sprints.complete(req.user.id, id, dto);
  }

  @Get('sprints/:id/report')
  sprintReport(@Req() req: AuthedRequest, @Param('id', uuid()) id: string) {
    return this.sprints.report(req.user.id, id);
  }

  @Post('projects/:id/tasks')
  createTask(
    @Req() req: AuthedRequest,
    @Param('id', uuid()) id: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasks.create(req.user.id, id, dto);
  }

  @Get('tasks/:id')
  getTask(@Req() req: AuthedRequest, @Param('id', uuid()) id: string) {
    return this.tasks.get(req.user.id, id);
  }

  @Patch('tasks/:id')
  @HttpCode(204)
  updateTask(
    @Req() req: AuthedRequest,
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasks.update(req.user.id, id, dto);
  }

  @Delete('tasks/:id')
  @HttpCode(204)
  deleteTask(@Req() req: AuthedRequest, @Param('id', uuid()) id: string) {
    return this.tasks.remove(req.user.id, id);
  }
}
