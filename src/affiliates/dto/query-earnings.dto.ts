import { AffiliateEarningStatus, AffiliateEarningType } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class QueryEarningsDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(AffiliateEarningType)
  type?: AffiliateEarningType;

  @IsOptional()
  @IsEnum(AffiliateEarningStatus)
  status?: AffiliateEarningStatus;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
