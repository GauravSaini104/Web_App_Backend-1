import { AffiliatePayoutStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewPayoutDto {
  @IsEnum(AffiliatePayoutStatus, {
    message: `status must be one of: ${AffiliatePayoutStatus.PAID}, ${AffiliatePayoutStatus.REJECTED}`,
  })
  status!: AffiliatePayoutStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  transactionRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  staffNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}
