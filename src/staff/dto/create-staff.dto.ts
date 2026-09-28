import { IsBoolean, IsNotEmpty, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateStaffDto {
  @IsString()
  @IsNotEmpty()
  @Length(3, 50)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'username can only contain letters, numbers, dots, underscores, and hyphens',
  })
  username!: string;

  @IsString()
  @IsNotEmpty()
  @Length(6, 100, { message: 'password must be at least 6 characters' })
  password!: string;

  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  displayName!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}
