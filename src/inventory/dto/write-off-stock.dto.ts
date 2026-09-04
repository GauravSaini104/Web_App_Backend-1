import { Type } from 'class-transformer';
import { IsInt, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Removes stock that can no longer be sold — damaged in transit, spoiled,
 * past its expiry date, etc. The `reason` field is what distinguishes
 * "damaged" from "expired" (e.g. "Expired — pulled from shelf 2026-09-01"),
 * rather than needing a separate transaction type for each.
 */
export class WriteOffStockDto {
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  quantity!: number;

  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  performedBy!: string;
}
