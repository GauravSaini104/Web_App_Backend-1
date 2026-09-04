import { OrderStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class QueryOrdersDto {
  @IsOptional()
  @IsEnum(OrderStatus, {
    message: `status must be one of: ${Object.values(OrderStatus).join(', ')}`,
  })
  status?: OrderStatus;
}
