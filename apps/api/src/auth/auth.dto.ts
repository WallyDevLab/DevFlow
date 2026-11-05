import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { MaxBytes } from '../common/validators.js';
import { singleLine } from '../common/transforms.js';

const normaliseEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

// bcrypt only uses the first 72 BYTES of a password, so that is the cap
// (characters outside basic ASCII take several bytes).
export class RegisterDto {
  @Transform(normaliseEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(8)
  @MaxBytes(72)
  password: string;

  @Transform(singleLine)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;
}

export class LoginDto {
  @Transform(normaliseEmail)
  @IsEmail()
  email: string;

  @IsString()
  @MaxBytes(72)
  password: string;
}

export class ForgotPasswordDto {
  @Transform(normaliseEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @MaxLength(200)
  token: string;

  @IsString()
  @MinLength(8)
  @MaxBytes(72)
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxBytes(72)
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @MaxBytes(72)
  newPassword: string;
}

export class VerifyEmailDto {
  @IsString()
  @MaxLength(200)
  token: string;
}

export class UpdateProfileDto {
  @Transform(singleLine)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;
}
