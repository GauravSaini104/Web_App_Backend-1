import { IsString, MaxLength, MinLength } from 'class-validator';

export class StaffRegisterDto {
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username!: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(200)
  password!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName!: string;
}
