import { Type } from 'class-transformer';
import { IsInt, IsPositive, Max } from 'class-validator';
import { MAX_CART_ITEM_QUANTITY } from '../cart.constants';

/** Sets the exact quantity for this line (a stepper/input), not a delta. */
export class UpdateCartItemDto {
  @IsInt()
  @IsPositive()
  @Max(MAX_CART_ITEM_QUANTITY)
  @Type(() => Number)
  quantity!: number;
}
