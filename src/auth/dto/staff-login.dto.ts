import { IsString } from 'class-validator';

export class StaffLoginDto {
  @IsString()
  username!: string;

  @IsString()
  password!: string;
}
