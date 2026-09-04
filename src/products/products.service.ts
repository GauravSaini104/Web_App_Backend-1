import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { slugify } from '../common/utils/slugify';
import { handlePrismaError } from '../common/utils/prisma-error.util';
import { PaginatedResult } from '../common/dto/pagination-query.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { CreateProductVariantDto } from './dto/create-product-variant.dto';
import { UpdateProductVariantDto } from './dto/update-product-variant.dto';
import { DEFAULT_LOW_STOCK_THRESHOLD } from '../inventory/inventory.constants';

const PRODUCT_INCLUDE = { brand: true, category: true, variants: true } as const;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProductDto) {
    dto.variants.forEach((variant) =>
      this.assertSellingPriceValid(variant.mrp, variant.sellingPrice),
    );

    try {
      return await this.prisma.product.create({
        data: {
          name: dto.name,
          slug: dto.slug ?? slugify(dto.name),
          description: dto.description,
          brandId: dto.brandId,
          categoryId: dto.categoryId,
          imageUrl: dto.imageUrl,
          isActive: dto.isActive,
          variants: {
            create: dto.variants.map((variant) => ({
              sku: variant.sku,
              mrp: variant.mrp,
              sellingPrice: variant.sellingPrice,
              unit: variant.unit,
              weight: variant.weight,
              isActive: variant.isActive,
              // Every variant needs a stock record to exist at all — start
              // it at 0 on-hand rather than leaving inventory undefined
              // for a brand-new pack size.
              inventory: { create: {} },
            })),
          },
        },
        include: PRODUCT_INCLUDE,
      });
    } catch (error) {
      handlePrismaError(error, 'Product');
    }
  }

  async findAll(query: QueryProductDto): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.ProductWhereInput = {
      ...(query.search && {
        // A barcode scanner just types the scanned code into whatever field
        // has focus — matching both name and variant SKU means a scanned
        // barcode and a typed product name both work from one search box.
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { variants: { some: { sku: { equals: query.search } } } },
        ],
      }),
      ...(query.categoryId && { categoryId: query.categoryId }),
      ...(query.brandId && { brandId: query.brandId }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
        include: PRODUCT_INCLUDE,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items: await this.attachAvailability(items),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: PRODUCT_INCLUDE,
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    const [enriched] = await this.attachAvailability([product]);
    return enriched;
  }

  /**
   * Exact-match lookup by SKU/barcode — the checkout counter's main path.
   * A barcode belongs to a specific pack size, so this looks up the
   * variant directly and includes its parent product for display.
   */
  async findBySku(sku: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { sku },
      include: { product: { include: { brand: true, category: true } } },
    });
    if (!variant) {
      throw new NotFoundException('No product with that barcode');
    }
    const [{ variants }] = await this.attachAvailability([{ variants: [variant] }]);
    return variants[0];
  }

  /**
   * Adds `isAvailable`/`isLowStock` to each variant, computed from live
   * stock — never an exact quantity (that stays internal), just enough for
   * a customer-facing "Add to Cart" vs "Out of Stock" decision. Batched
   * into 2 queries total regardless of how many products/variants are
   * being enriched, so a paginated product list stays cheap.
   */
  private async attachAvailability<
    TVariant extends { id: string },
    T extends { variants: TVariant[] },
  >(
    products: T[],
  ): Promise<
    (Omit<T, 'variants'> & {
      variants: (TVariant & { isAvailable: boolean; isLowStock: boolean })[];
    })[]
  > {
    const variantIds = products.flatMap((product) => product.variants.map((variant) => variant.id));
    if (variantIds.length === 0) {
      return products.map((product) => ({ ...product, variants: [] }));
    }

    const [inventories, reservedRows] = await Promise.all([
      this.prisma.inventory.findMany({ where: { variantId: { in: variantIds } } }),
      this.prisma.stockReservation.groupBy({
        by: ['variantId'],
        where: { variantId: { in: variantIds }, status: 'ACTIVE', expiresAt: { gt: new Date() } },
        _sum: { quantity: true },
      }),
    ]);

    const inventoryByVariant = new Map(inventories.map((inv) => [inv.variantId, inv]));
    const reservedByVariant = new Map(
      reservedRows.map((row) => [row.variantId, row._sum.quantity ?? 0]),
    );

    return products.map((product) => ({
      ...product,
      variants: product.variants.map((variant) => {
        const inventory = inventoryByVariant.get(variant.id);
        const reserved = reservedByVariant.get(variant.id) ?? 0;
        const available = (inventory?.quantityOnHand ?? 0) - reserved;
        const threshold = inventory?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
        return {
          ...variant,
          isAvailable: Boolean(inventory?.isSellable) && available > 0,
          isLowStock: available > 0 && available <= threshold,
        };
      }),
    }));
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOne(id);
    try {
      return await this.prisma.product.update({
        where: { id },
        data: {
          name: dto.name,
          slug: dto.slug,
          description: dto.description,
          brandId: dto.brandId,
          categoryId: dto.categoryId,
          imageUrl: dto.imageUrl,
          isActive: dto.isActive,
        },
        include: PRODUCT_INCLUDE,
      });
    } catch (error) {
      handlePrismaError(error, 'Product');
    }
  }

  /**
   * Soft delete: retires the product and every one of its pack sizes
   * instead of erasing rows. A product that has ever been sold needs to
   * keep existing for its own order/stock history to make sense — this is
   * "no longer available," not "never existed." Reactivate later with a
   * plain PATCH { isActive: true }.
   */
  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.prisma.$transaction([
        this.prisma.product.update({ where: { id }, data: { isActive: false } }),
        this.prisma.productVariant.updateMany({
          where: { productId: id },
          data: { isActive: false },
        }),
      ]);
    } catch (error) {
      handlePrismaError(error, 'Product');
    }
  }

  async addVariant(productId: string, dto: CreateProductVariantDto) {
    await this.findOne(productId);
    this.assertSellingPriceValid(dto.mrp, dto.sellingPrice);

    try {
      return await this.prisma.productVariant.create({
        data: {
          productId,
          sku: dto.sku,
          mrp: dto.mrp,
          sellingPrice: dto.sellingPrice,
          unit: dto.unit,
          weight: dto.weight,
          isActive: dto.isActive,
          inventory: { create: {} },
        },
      });
    } catch (error) {
      handlePrismaError(error, 'Product variant');
    }
  }

  async updateVariant(productId: string, variantId: string, dto: UpdateProductVariantDto) {
    const variant = await this.findVariantOrThrow(productId, variantId);

    const mrp = dto.mrp ?? Number(variant.mrp);
    const sellingPrice = dto.sellingPrice ?? Number(variant.sellingPrice);
    this.assertSellingPriceValid(mrp, sellingPrice);

    try {
      return await this.prisma.productVariant.update({
        where: { id: variantId },
        data: {
          sku: dto.sku,
          mrp: dto.mrp,
          sellingPrice: dto.sellingPrice,
          unit: dto.unit,
          weight: dto.weight,
          isActive: dto.isActive,
        },
      });
    } catch (error) {
      handlePrismaError(error, 'Product variant');
    }
  }

  /**
   * Soft delete: retires this one pack size instead of erasing the row —
   * same reasoning as `remove()` above. Idempotent if it's already
   * inactive, and blocked only if it's currently the product's last
   * *active* pack size (a product with zero sellable sizes can't be sold).
   */
  async removeVariant(productId: string, variantId: string) {
    const variant = await this.findVariantOrThrow(productId, variantId);

    if (variant.isActive) {
      const otherActiveVariants = await this.prisma.productVariant.count({
        where: { productId, isActive: true, id: { not: variantId } },
      });
      if (otherActiveVariants === 0) {
        throw new BadRequestException(
          'Cannot remove the only active pack size on this product — add another size first, or delete the product instead.',
        );
      }
    }

    try {
      await this.prisma.productVariant.update({
        where: { id: variantId },
        data: { isActive: false },
      });
    } catch (error) {
      handlePrismaError(error, 'Product variant');
    }
  }

  private async findVariantOrThrow(productId: string, variantId: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId },
    });
    if (!variant) {
      throw new NotFoundException('Product variant not found');
    }
    return variant;
  }

  /** A discounted selling price can never exceed the MRP. */
  private assertSellingPriceValid(mrp: number, sellingPrice: number) {
    if (sellingPrice > mrp) {
      throw new BadRequestException('sellingPrice cannot be greater than mrp');
    }
  }
}
