import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WorkflowController } from './workflow.controller.js';
import { WorkflowService } from './workflow.service.js';
import { CollabController } from './collab.controller.js';
import { CollabService } from './collab.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { SprintsService } from './sprints.service.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ProjectsController, CollabController, WorkflowController],
  providers: [
    ProjectsService,
    TasksService,
    SprintsService,
    CollabService,
    WorkflowService,
  ],
})
export class ProjectsModule {}
