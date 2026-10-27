import { AffiliateStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class ReviewAffiliateDto {
  @IsEnum(AffiliateStatus, {
    message: `status must be one of: ${Object.values(AffiliateStatus).join(', ')}`,
  })
  status!: AffiliateStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  staffNotes?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @Type(() => Number)
  customCommissionRate?: number | null;
}
