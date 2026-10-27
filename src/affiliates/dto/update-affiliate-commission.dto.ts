import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Max, Min, ValidateIf } from 'class-validator';

export class UpdateAffiliateCommissionDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @Type(() => Number)
  customCommissionRate?: number | null;
}
