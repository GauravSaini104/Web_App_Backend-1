import { AffiliateStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

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
}
