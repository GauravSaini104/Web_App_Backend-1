import { Type } from 'class-transformer';
import { IsInt, IsString, MaxLength, MinLength, NotEquals } from 'class-validator';

/** For correcting stock counts after a manual physical count. */
export class AdjustStockDto {
  @IsInt()
  @NotEquals(0, { message: 'quantityDelta must not be zero — there is nothing to adjust' })
  @Type(() => Number)
  quantityDelta!: number;

  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  performedBy!: string;
}
