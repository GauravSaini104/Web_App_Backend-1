import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateBrandDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  /** Optional — auto-generated from `name` when omitted. */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase, alphanumeric, and hyphen-separated (e.g. "nestle")',
  })
  slug?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
