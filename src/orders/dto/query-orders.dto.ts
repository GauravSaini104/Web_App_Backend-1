import { FulfillmentMethod, OrderStatus, PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

const SORTABLE_FIELDS = ['createdAt', 'orderNumber', 'subtotal'] as const;
export type OrderSortField = (typeof SORTABLE_FIELDS)[number];

const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export class QueryOrdersDto {
  @IsOptional()
  @IsEnum(OrderStatus, {
    message: `status must be one of: ${Object.values(OrderStatus).join(', ')}`,
  })
  status?: OrderStatus;

  @IsOptional()
  @IsEnum(PaymentMethod, {
    message: `paymentMethod must be one of: ${Object.values(PaymentMethod).join(', ')}`,
  })
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsEnum(FulfillmentMethod, {
    message: `fulfillmentMethod must be one of: ${Object.values(FulfillmentMethod).join(', ')}`,
  })
  fulfillmentMethod?: FulfillmentMethod;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  maxAmount?: number;

  /** Free-text search matching order #, ID, customer phone/name, address/pincode, product name/SKU, or payment IDs */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsPositive()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsPositive()
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsIn(SORTABLE_FIELDS)
  sortBy?: OrderSortField = 'createdAt';

  @IsOptional()
  @IsIn(SORT_ORDERS)
  sortOrder?: SortOrder = 'desc';
}

