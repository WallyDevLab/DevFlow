import { Transform, Type } from 'class-transformer';
import { singleLine } from '../common/transforms.js';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateProjectDto {
  @Transform(singleLine)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  // Short prefix for task ids, e.g. DEV -> DEV-124.
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z][A-Z0-9]{1,4}$/, {
    message: 'key must be 2-5 letters or digits, starting with a letter',
  })
  key: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class UpdateProjectDto {
  @IsOptional()
  @Transform(singleLine)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'ARCHIVED'])
  status?: 'ACTIVE' | 'ARCHIVED';
}

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export class CreateTaskDto {
  @Transform(singleLine)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @IsOptional()
  @IsUUID()
  statusId?: string;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: (typeof PRIORITIES)[number];

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  storyPoints?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

// Nullable fields use IsOptional, which also accepts null so clients can clear them.
export class UpdateTaskDto {
  @IsOptional()
  @Transform(singleLine)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @IsOptional()
  @IsUUID()
  statusId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  position?: number;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: (typeof PRIORITIES)[number];

  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  storyPoints?: number | null;

  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsBoolean()
  blocked?: boolean;

  // Replaces the task's full set of labels.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  labelIds?: string[];

  // Sprint scope and backlog ordering need planning permissions.
  @IsOptional()
  @IsUUID()
  sprintId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  backlogRank?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  blockedReason?: string | null;
}
