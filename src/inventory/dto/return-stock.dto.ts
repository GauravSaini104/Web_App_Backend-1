import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

/** Stock physically coming back in sellable condition — a post-dispatch refund/return. */
export class ReturnStockDto {
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

  /** Placeholder until Orders exist — which order this return relates to. */
  @IsOptional()
  @IsString()
  orderId?: string;
}
