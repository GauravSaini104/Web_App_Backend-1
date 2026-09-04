import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';
import { UnitOfMeasure } from '@prisma/client';

/** One purchasable pack size of a product — e.g. "Tata Sugar, 1kg". */
export class CreateProductVariantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Type(() => Number)
  mrp!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Type(() => Number)
  sellingPrice!: number;

  @IsEnum(UnitOfMeasure, {
    message: `unit must be one of: ${Object.values(UnitOfMeasure).join(', ')}`,
  })
  unit!: UnitOfMeasure;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Type(() => Number)
  weight!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
