import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateReservationDto {
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  quantity!: number;

  /** Placeholder until Orders exist (Step 5) — not a real foreign key yet. */
  @IsOptional()
  @IsString()
  orderId?: string;
}
