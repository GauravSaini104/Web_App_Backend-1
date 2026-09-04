import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateProductDto } from './create-product.dto';

// Variants aren't editable through PATCH /products/:id — they have their
// own endpoints (POST/PATCH/DELETE .../variants) since adding, pricing, and
// removing a pack size are distinct actions from editing the product itself.
export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['variants'] as const),
) {}
