import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class BulkImportProductDto {
  @IsNotEmpty({ message: 'categoryId is required' })
  @IsString()
  categoryId!: string;

  @IsOptional()
  @IsString()
  brandId?: string;

  @IsOptional()
  products?: any;
}

export interface BulkImportRowError {
  row: number;
  sku?: string;
  name?: string;
  reason: string;
}

export interface BulkImportResult {
  total: number;
  imported: number;
  failed: number;
  errors: BulkImportRowError[];
  products: any[];
}
