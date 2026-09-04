import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  label?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  line1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  line2?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  state!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'pincode must be exactly 6 digits' })
  pincode!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
