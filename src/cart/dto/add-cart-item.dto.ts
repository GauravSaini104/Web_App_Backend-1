import { Type } from 'class-transformer';
import { IsInt, IsPositive, IsString, Max } from 'class-validator';
import { MAX_CART_ITEM_QUANTITY } from '../cart.constants';

export class AddCartItemDto {
  @IsString()
  variantId!: string;

  @IsInt()
  @IsPositive()
  @Max(MAX_CART_ITEM_QUANTITY)
  @Type(() => Number)
  quantity!: number;
}
