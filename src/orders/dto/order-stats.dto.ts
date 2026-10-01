import { FulfillmentMethod, OrderStatus, PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class OrderStatsDto {
  /** Number of recent orders to return (default: 10, min: 1, max: 100) */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 10;

  /** Optional filter: only count / fetch orders created on or after this timestamp */
  @IsOptional()
  @IsDateString()
  startDate?: string;

  /** Optional filter: only count / fetch orders created on or before this timestamp */
  @IsOptional()
  @IsDateString()
  endDate?: string;

  /** Optional status filter */
  @IsOptional()
  @IsEnum(OrderStatus, {
    message: `status must be one of: ${Object.values(OrderStatus).join(', ')}`,
  })
  status?: OrderStatus;

  /** Optional payment method filter */
  @IsOptional()
  @IsEnum(PaymentMethod, {
    message: `paymentMethod must be one of: ${Object.values(PaymentMethod).join(', ')}`,
  })
  paymentMethod?: PaymentMethod;

  /** Optional fulfillment method filter */
  @IsOptional()
  @IsEnum(FulfillmentMethod, {
    message: `fulfillmentMethod must be one of: ${Object.values(FulfillmentMethod).join(', ')}`,
  })
  fulfillmentMethod?: FulfillmentMethod;
}
