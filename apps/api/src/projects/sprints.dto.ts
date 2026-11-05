import { Transform } from 'class-transformer';
import { singleLine } from '../common/transforms.js';
import {
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateSprintDto {
  @Transform(singleLine)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  goal?: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}

export class UpdateSprintDto {
  @IsOptional()
  @Transform(singleLine)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  goal?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class CompleteSprintDto {
  // Incomplete work must go somewhere explicitly: the backlog, or the id of
  // another sprint that is still being planned.
  @Matches(
    /^(BACKLOG|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    { message: 'incompleteTo must be "BACKLOG" or a sprint id' },
  )
  incompleteTo: string;
}
