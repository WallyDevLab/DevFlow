import { Transform } from 'class-transformer';
import { singleLine } from '../common/transforms.js';
import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';

// OWNER is never assignable through invitations or role changes.
export const ASSIGNABLE_ROLES = [
  'ADMIN',
  'SCRUM_MASTER',
  'PRODUCT_OWNER',
  'DEVELOPER',
  'VIEWER',
] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export class CreateWorkspaceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Transform(singleLine)
  name: string;
}

export class InviteMemberDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsIn(ASSIGNABLE_ROLES)
  role: AssignableRole;
}

export class UpdateRoleDto {
  @IsIn(ASSIGNABLE_ROLES)
  role: AssignableRole;
}

export class AcceptInvitationDto {
  @IsString()
  @MaxLength(200)
  token: string;
}
