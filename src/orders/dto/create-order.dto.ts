import { FulfillmentMethod, PaymentMethod } from '@prisma/client';
import { IsEnum, IsString, ValidateIf } from 'class-validator';

export class CreateOrderDto {
  @IsEnum(FulfillmentMethod, {
    message: `fulfillmentMethod must be one of: ${Object.values(FulfillmentMethod).join(', ')}`,
  })
  fulfillmentMethod!: FulfillmentMethod;

  @IsEnum(PaymentMethod, {
    message: `paymentMethod must be one of: ${Object.values(PaymentMethod).join(', ')}`,
  })
  paymentMethod!: PaymentMethod;

  /** Required when fulfillmentMethod is DELIVERY; ignored for PICKUP. */
  @ValidateIf((dto: CreateOrderDto) => dto.fulfillmentMethod === FulfillmentMethod.DELIVERY)
  @IsString()
  addressId?: string;
}
