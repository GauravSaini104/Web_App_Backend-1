import { Type } from 'class-transformer';
import { IsInt, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

// performedBy is a required free-text field for now (e.g. the staff
// member's name) since there's no login system yet (Step 3) to fill it in
// automatically — manual stock movements still need accountability.
export class ReceiveStockDto {
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
