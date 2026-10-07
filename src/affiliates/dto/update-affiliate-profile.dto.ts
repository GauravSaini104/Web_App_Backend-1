import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { UPI_REGEX } from '../affiliates.constants';

export class UpdateAffiliateProfileDto {
  @IsOptional()
  @IsString()
  @Matches(UPI_REGEX, { message: 'Invalid UPI ID format (e.g. name@okhdfcbank)' })
  upiId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  upiName?: string;
}
