import { Type } from 'class-transformer';
import { IsNumber, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAdjustmentDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  amount!: number; // Can be positive or negative

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
