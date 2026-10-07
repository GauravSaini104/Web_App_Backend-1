import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { UPI_REGEX } from '../affiliates.constants';

export class ApplyAffiliateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  primaryChannel!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  channelUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  audienceSize?: string;

  @IsString()
  @MinLength(20, { message: 'Motivation must be at least 20 characters' })
  @MaxLength(1000)
  motivation!: string;

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
