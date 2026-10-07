import { IsIn, IsOptional } from 'class-validator';

export class AffiliateStatsQueryDto {
  @IsOptional()
  @IsIn(['7d', '30d', '90d', 'all'], {
    message: 'range must be one of: 7d, 30d, 90d, all',
  })
  range?: '7d' | '30d' | '90d' | 'all' = '30d';

  @IsOptional()
  @IsIn(['day', 'week'], {
    message: 'bucket must be one of: day, week',
  })
  bucket?: 'day' | 'week' = 'day';
}
