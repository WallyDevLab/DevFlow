import { Transform } from 'class-transformer';
import { singleLine } from '../common/transforms.js';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsUUID,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateLabelDto {
  @Transform(singleLine)
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  name: string;

  @Matches(/^#[0-9a-fA-F]{6}$/, {
    message: 'color must be a hex value like #3987e5',
  })
  color: string;
}

export class UpdateLabelDto {
  @IsOptional()
  @Transform(singleLine)
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  name?: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, {
    message: 'color must be a hex value like #3987e5',
  })
  color?: string;
}

export class CommentDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body: string;

  // People @mentioned in the text. Each is checked against the workspace and
  // the body, so this can't be used to ping someone without saying so.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  mentionIds?: string[];
}
