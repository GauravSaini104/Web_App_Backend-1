import { IsNotEmpty, IsString, Length } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Current password is required' })
  currentPassword!: string;

  @IsString()
  @IsNotEmpty({ message: 'New password is required' })
  @Length(6, 100, { message: 'New password must be at least 6 characters' })
  newPassword!: string;

  @IsString()
  @IsNotEmpty({ message: 'Confirm password is required' })
  confirmPassword!: string;
}

