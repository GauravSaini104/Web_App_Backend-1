import { IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';

export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  @Length(3, 50)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'username can only contain letters, numbers, dots, underscores, and hyphens',
  })
  username?: string;

  @IsOptional()
  @IsString()
  @Length(6, 100, { message: 'password must be at least 6 characters' })
  password?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  displayName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
