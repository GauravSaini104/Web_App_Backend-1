import { PaymentStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class QueryPaymentsDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(PaymentStatus, {
    message: `status must be one of: ${Object.values(PaymentStatus).join(', ')}`,
  })
  status?: PaymentStatus;

  @IsOptional()
  @IsString()
  orderId?: string;
}

