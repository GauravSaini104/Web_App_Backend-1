import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

/** Admin-editable settings — not the stock count itself (use receive/adjust/write-off for that). */
export class UpdateInventorySettingsDto {
  /** Set explicitly to null to fall back to the platform-wide default. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  lowStockThreshold?: number | null;

  @IsOptional()
  @IsBoolean()
  isSellable?: boolean;
}
