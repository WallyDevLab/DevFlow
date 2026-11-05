import { Transform, Type } from 'class-transformer';
import { singleLine } from '../common/transforms.js';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const CATEGORIES = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
] as const;
export type CategoryName = (typeof CATEGORIES)[number];

export class CreateStatusDto {
  @Transform(singleLine)
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  name: string;

  // What the column means for analytics (cycle time starts at In Progress /
  // In Review and ends at Done), whatever it is called.
  @IsIn(CATEGORIES)
  category: CategoryName;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  wipLimit?: number;
}

export class UpdateStatusDto {
  @IsOptional()
  @Transform(singleLine)
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  name?: string;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: CategoryName;

  // null removes the limit.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  wipLimit?: number | null;
}

export class ReorderStatusesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsUUID('all', { each: true })
  ids: string[];
}

export class DeleteStatusQuery {
  @IsOptional()
  @IsUUID()
  moveTo?: string;
}
