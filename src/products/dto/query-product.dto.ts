import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

// sellingPrice isn't sortable here anymore — a product can have several
// prices now (one per pack size), so "sort products by price" is ambiguous
// at this level. Sort by price within a single product's variants instead.
const SORTABLE_FIELDS = ['name', 'createdAt'] as const;
export type ProductSortField = (typeof SORTABLE_FIELDS)[number];

const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export class QueryProductDto extends PaginationQueryDto {
  /** Case-insensitive partial match on product name, or exact match on a variant's SKU. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  brandId?: string;

  @IsOptional()
  @IsIn(SORTABLE_FIELDS)
  sortBy?: ProductSortField = 'createdAt';

  @IsOptional()
  @IsIn(SORT_ORDERS)
  sortOrder?: SortOrder = 'desc';
}
