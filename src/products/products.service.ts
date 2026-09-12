import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InventoryTransactionType, Prisma, UnitOfMeasure } from '@prisma/client';
import { Request } from 'express';
import { existsSync, unlinkSync } from 'node:fs';
import * as xlsx from 'xlsx';
import { PrismaService } from '../database/prisma.service';
import { slugify } from '../common/utils/slugify';
import { handlePrismaError } from '../common/utils/prisma-error.util';
import { PaginatedResult } from '../common/dto/pagination-query.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { CreateProductVariantDto } from './dto/create-product-variant.dto';
import { UpdateProductVariantDto } from './dto/update-product-variant.dto';
import { BulkImportResult, BulkImportRowError } from './dto/bulk-import-product.dto';
import { DEFAULT_LOW_STOCK_THRESHOLD } from '../inventory/inventory.constants';
import { getBaseUrl, getFullImageUrl } from '../uploads/uploads.config';

const PRODUCT_INCLUDE = { brand: true, category: true, variants: true } as const;

export function formatImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const baseUrl = getBaseUrl();

  if (url.startsWith('data:')) {
    return url;
  }

  if (url.includes('/uploads/products/')) {
    const filename = url.split('/uploads/products/')[1].split('?')[0];
    return `${baseUrl}/uploads/products/${filename}`;
  }

  if (url.includes('/uploads/')) {
    const relativePath = url.split('/uploads/')[1].split('?')[0];
    return `${baseUrl}/uploads/${relativePath}`;
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  const cleanPath = url.startsWith('/') ? url : `/${url}`;
  return `${baseUrl}${cleanPath}`;
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) { }

  private formatProduct<T extends Record<string, any>>(product: T): T {
    if (!product) return product;
    return {
      ...product,
      ...(product.imageUrl !== undefined && { imageUrl: formatImageUrl(product.imageUrl) }),
      ...(product.images !== undefined && {
        images: Array.isArray(product.images)
          ? product.images.map((img: string) => formatImageUrl(img) || img)
          : [],
      }),
      ...(Array.isArray(product.variants) && {
        variants: product.variants.map((v: any) => ({
          ...v,
          ...(v.imageUrl !== undefined && { imageUrl: formatImageUrl(v.imageUrl) }),
          ...(v.images !== undefined && {
            images: Array.isArray(v.images)
              ? v.images.map((img: string) => formatImageUrl(img) || img)
              : [],
          }),
        })),
      }),
      ...(product.product && {
        product: this.formatProduct(product.product),
      }),
    };
  }

  async create(dto: CreateProductDto, files?: Express.Multer.File[], req?: Request) {
    dto.variants.forEach((variant) =>
      this.assertSellingPriceValid(variant.mrp, variant.sellingPrice),
    );

    // Handle physical uploaded files if provided
    if (files && files.length > 0) {
      const productUploadedUrls: string[] = [];

      for (const file of files) {
        const fullUrl = getFullImageUrl(file.filename, req);

        // Check if file is assigned to a specific variant (e.g. variants[0][images] or variant_0_image)
        const variantMatch = file.fieldname.match(/variants?\[?(\d+)\]?/i);
        if (variantMatch) {
          const index = parseInt(variantMatch[1], 10);
          if (dto.variants && dto.variants[index]) {
            const vImages = dto.variants[index].images || [];
            dto.variants[index].images = [...vImages, fullUrl];
            if (!dto.variants[index].imageUrl) {
              dto.variants[index].imageUrl = fullUrl;
            }
            continue;
          }
        }

        // Otherwise it's a product-level image
        productUploadedUrls.push(fullUrl);
      }

      if (productUploadedUrls.length > 0) {
        const currentImages = dto.images || [];
        dto.images = [...currentImages, ...productUploadedUrls];
        if (!dto.imageUrl) {
          dto.imageUrl = dto.images[0];
        }
      }
    }

    const productImages = dto.images ?? (dto.imageUrl ? [dto.imageUrl] : []);
    const productImageUrl = dto.imageUrl ?? (productImages.length > 0 ? productImages[0] : null);

    try {
      const product = await this.prisma.product.create({
        data: {
          name: dto.name,
          slug: dto.slug ?? slugify(dto.name),
          description: dto.description,
          brandId: dto.brandId,
          categoryId: dto.categoryId,
          imageUrl: productImageUrl,
          images: productImages,
          isActive: dto.isActive,
          variants: {
            create: dto.variants.map((variant) => {
              const variantImages = variant.images ?? (variant.imageUrl ? [variant.imageUrl] : []);
              const variantImageUrl = variant.imageUrl ?? (variantImages.length > 0 ? variantImages[0] : null);
              return {
                sku: variant.sku,
                mrp: variant.mrp,
                sellingPrice: variant.sellingPrice,
                unit: variant.unit,
                weight: variant.weight,
                imageUrl: variantImageUrl,
                images: variantImages,
                isActive: variant.isActive,
                // Every variant needs a stock record to exist at all — start
                // it at 0 on-hand rather than leaving inventory undefined
                // for a brand-new pack size.
                inventory: { create: {} },
              };
            }),
          },
        },
        include: PRODUCT_INCLUDE,
      });
      return this.formatProduct(product);
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

  /**
   * Fetches all products belonging to a specific category.
   * Checks if category exists and returns paginated, availability-enriched products.
   */
  async findByCategory(categoryId: string, query: QueryProductDto = {}): Promise<PaginatedResult<unknown>> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return this.findAll({
      ...query,
      categoryId,
    });
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

    return products.map((product) => {
      const formatted = this.formatProduct(product);
      return {
        ...formatted,
        variants: (formatted.variants || []).map((variant: any) => {
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
      };
    });
  }

  async update(
    id: string,
    dto: UpdateProductDto,
    files?: Express.Multer.File[],
    req?: Request,
  ) {
    await this.findOne(id);

    if (files && files.length > 0) {
      const uploadedUrls = files.map((f) => getFullImageUrl(f.filename, req));
      dto.images = [...(dto.images || []), ...uploadedUrls];
      if (!dto.imageUrl && dto.images.length > 0) {
        dto.imageUrl = dto.images[0];
      }
    }

    try {
      const updated = await this.prisma.product.update({
        where: { id },
        data: {
          name: dto.name,
          slug: dto.slug,
          description: dto.description,
          brandId: dto.brandId,
          categoryId: dto.categoryId,
          imageUrl: dto.imageUrl,
          images: dto.images,
          isActive: dto.isActive,
        },
        include: PRODUCT_INCLUDE,
      });
      return this.formatProduct(updated);
    } catch (error) {
      handlePrismaError(error, 'Product');
    }
  }

  /**
   * Uploads multiple images for a product and updates the product record.
   * Generates full URLs based on BASE_URL and returns full URLs and updated product.
   */
  async uploadImages(id: string, files?: Express.Multer.File[], req?: Request) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files were uploaded');
    }

    const cleanId = (id || '').trim().replace(/^["']|["']$/g, '');

    let product = await this.prisma.product.findUnique({
      where: { id: cleanId },
    });

    let matchedVariantId: string | null = null;
    if (!product) {
      const variant = await this.prisma.productVariant.findUnique({
        where: { id: cleanId },
        include: { product: true },
      });
      if (variant) {
        product = variant.product;
        matchedVariantId = variant.id;
      }
    }

    if (!product) {
      for (const file of files) {
        if (file.path && existsSync(file.path)) {
          try {
            unlinkSync(file.path);
          } catch {
            // ignore cleanup error
          }
        }
      }
      throw new NotFoundException(`Product with ID "${id}" not found`);
    }

    const newUrls = files.map((file) => getFullImageUrl(file.filename, req));
    const currentImages = product.images || [];
    const combinedImages = Array.from(new Set([...currentImages, ...newUrls]));

    if (matchedVariantId) {
      const variant = await this.prisma.productVariant.findUnique({ where: { id: matchedVariantId } });
      const currentVarImages = variant?.images || [];
      const combinedVarImages = Array.from(new Set([...currentVarImages, ...newUrls]));
      await this.prisma.productVariant.update({
        where: { id: matchedVariantId },
        data: {
          imageUrl: variant?.imageUrl || newUrls[0],
          images: combinedVarImages,
        },
      });
    }

    const updatedProduct = await this.prisma.product.update({
      where: { id: product.id },
      data: {
        imageUrl: product.imageUrl || newUrls[0],
        images: combinedImages,
      },
      include: PRODUCT_INCLUDE,
    });

    return {
      urls: newUrls,
      product: this.formatProduct(updatedProduct),
    };
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

  async addVariant(
    productId: string,
    dto: CreateProductVariantDto,
    files?: Express.Multer.File[],
    req?: Request,
  ) {
    await this.findOne(productId);
    this.assertSellingPriceValid(dto.mrp, dto.sellingPrice);

    if (files && files.length > 0) {
      const uploadedUrls = files.map((f) => getFullImageUrl(f.filename, req));
      dto.images = [...(dto.images || []), ...uploadedUrls];
      if (!dto.imageUrl && dto.images.length > 0) {
        dto.imageUrl = dto.images[0];
      }
    }

    const variantImages = dto.images ?? (dto.imageUrl ? [dto.imageUrl] : []);
    const variantImageUrl = dto.imageUrl ?? (variantImages.length > 0 ? variantImages[0] : null);

    try {
      const variant = await this.prisma.productVariant.create({
        data: {
          productId,
          sku: dto.sku,
          mrp: dto.mrp,
          sellingPrice: dto.sellingPrice,
          unit: dto.unit,
          weight: dto.weight,
          imageUrl: variantImageUrl,
          images: variantImages,
          isActive: dto.isActive,
          inventory: { create: {} },
        },
      });
      return this.formatProduct(variant);
    } catch (error) {
      handlePrismaError(error, 'Product variant');
    }
  }

  async updateVariant(
    productId: string,
    variantId: string,
    dto: UpdateProductVariantDto,
    files?: Express.Multer.File[],
    req?: Request,
  ) {
    const variant = await this.findVariantOrThrow(productId, variantId);

    const mrp = dto.mrp ?? Number(variant.mrp);
    const sellingPrice = dto.sellingPrice ?? Number(variant.sellingPrice);
    this.assertSellingPriceValid(mrp, sellingPrice);

    if (files && files.length > 0) {
      const uploadedUrls = files.map((f) => getFullImageUrl(f.filename, req));
      dto.images = [...(dto.images || []), ...uploadedUrls];
      if (!dto.imageUrl && dto.images.length > 0) {
        dto.imageUrl = dto.images[0];
      }
    }

    
    try {
      const updated = await this.prisma.productVariant.update({
        where: { id: variantId },
        data: {
          sku: dto.sku,
          mrp: dto.mrp,
          sellingPrice: dto.sellingPrice,
          unit: dto.unit,
          weight: dto.weight,
          imageUrl: dto.imageUrl,
          images: dto.images,
          isActive: dto.isActive,
        },
      });
      return this.formatProduct(updated);
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

  /**
   * Generates a sample CSV / Excel template for bulk product import.
   */
  generateBulkImportTemplate(format: 'xlsx' | 'csv' = 'xlsx') {
    const sampleData = [
      {
        Name: 'Fortune Sunlite Refined Sunflower Oil',
        Description: 'Rich in vitamins, unadulterated edible cooking oil',
        SKU: 'FORT-SUN-1L',
        MRP: 160.0,
        SellingPrice: 145.0,
        Unit: 'L',
        Weight: 1.0,
        InitialStock: 50,
        ImageUrl: 'https://example.com/fortune-oil.jpg',
        Images: 'https://example.com/fortune-1.jpg, https://example.com/fortune-2.jpg',
      },
      {
        Name: 'Tata Salt Vacuum Evaporated',
        Description: 'Iodized salt with essential minerals',
        SKU: 'TATA-SALT-1KG',
        MRP: 30.0,
        SellingPrice: 28.0,
        Unit: 'KG',
        Weight: 1.0,
        InitialStock: 100,
        ImageUrl: 'https://example.com/tata-salt.jpg',
        Images: '',
      },
      {
        Name: 'Aashirvaad Superior MP Sharbati Atta',
        Description: '100% pure whole wheat flour',
        SKU: 'AASH-ATTA-5KG',
        MRP: 280.0,
        SellingPrice: 260.0,
        Unit: 'KG',
        Weight: 5.0,
        InitialStock: 40,
        ImageUrl: 'https://example.com/aashirvaad-atta.jpg',
        Images: '',
      },
    ];

    const worksheet = xlsx.utils.json_to_sheet(sampleData);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Products');

    if (format === 'csv') {
      const csvOutput = xlsx.utils.sheet_to_csv(worksheet);
      return {
        buffer: Buffer.from(csvOutput, 'utf-8'),
        mimeType: 'text/csv',
        filename: 'products_bulk_import_template.csv',
      };
    }

    const excelBuffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    return {
      buffer: excelBuffer,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: 'products_bulk_import_template.xlsx',
    };
  }

  private normalizeUnit(rawUnit: any): UnitOfMeasure {
    if (!rawUnit) return UnitOfMeasure.PCS;
    const clean = String(rawUnit).trim().toUpperCase();
    if (clean === 'G' || clean === 'GM' || clean === 'GRAM' || clean === 'GRAMS') {
      return UnitOfMeasure.G;
    }
    if (clean === 'KG' || clean === 'KILO' || clean === 'KILOGRAM' || clean === 'KILOGRAMS') {
      return UnitOfMeasure.KG;
    }
    if (clean === 'ML' || clean === 'MILLILITER' || clean === 'MILLILITRE') {
      return UnitOfMeasure.ML;
    }
    if (
      clean === 'L' ||
      clean === 'LT' ||
      clean === 'LTR' ||
      clean === 'LITER' ||
      clean === 'LITRE' ||
      clean === 'LITERS' ||
      clean === 'LITRES'
    ) {
      return UnitOfMeasure.L;
    }
    if (
      clean === 'PCS' ||
      clean === 'PC' ||
      clean === 'PIECE' ||
      clean === 'PIECES' ||
      clean === 'PKT' ||
      clean === 'PACKET' ||
      clean === 'BOX' ||
      clean === 'CAN' ||
      clean === 'BOTTLE' ||
      clean === 'UNIT'
    ) {    
      return UnitOfMeasure.PCS;
    }
    if (Object.values(UnitOfMeasure).includes(clean as any)) {
      return clean as UnitOfMeasure;
    }
    throw new Error(`Invalid unit '${rawUnit}'. Supported units are G, KG, ML, L, PCS.`);
  }

  private getRowField(row: Record<string, any>, ...fieldAliases: string[]): any {
    const keys = Object.keys(row);
    for (const alias of fieldAliases) {
      const target = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
      const matchKey = keys.find(
        (k) => k.toLowerCase().replace(/[^a-z0-9]/g, '') === target,
      );
      if (
        matchKey !== undefined &&
        row[matchKey] !== undefined &&
        row[matchKey] !== null &&
        String(row[matchKey]).trim() !== ''
      ) {
        return row[matchKey];
      }
    }
    return undefined;
  }

  async bulkImport(
    categoryId: string,
    brandId?: string,
    file?: Express.Multer.File,
    rawProductsPayload?: any,
    staffId?: string,
  ): Promise<BulkImportResult> {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new BadRequestException(`Category with ID '${categoryId}' not found`);
    }

    if (brandId) {
      const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
      if (!brand) {
        throw new BadRequestException(`Brand with ID '${brandId}' not found`);
      }
    }


    let rawRows: any[] = [];

    if (file && file.buffer) {
      try {
        const workbook = xlsx.read(file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          throw new BadRequestException('The uploaded file contains no sheets');
        }
        rawRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
      } catch (err: any) {
        throw new BadRequestException(`Failed to parse spreadsheet file: ${err.message}`);
      }
    } else if (rawProductsPayload) {
      if (typeof rawProductsPayload === 'string') {
        try {
          rawRows = JSON.parse(rawProductsPayload);
        } catch {
          throw new BadRequestException('Invalid JSON provided in products payload');
        }
      } else if (Array.isArray(rawProductsPayload)) {
        rawRows = rawProductsPayload;
      }
    }

    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      throw new BadRequestException('No product rows found to import in file or payload');
    }

    const errors: BulkImportRowError[] = [];
    const validRowsToInsert: any[] = [];
    const incomingSkusInFile = new Set<string>();

    for (let index = 0; index < rawRows.length; index++) {
      const row = rawRows[index];
      const rowNumber = index + 2; // Row 1 is header row in Excel/CSV

      const name = this.getRowField(row, 'name', 'productName', 'product_name', 'title');
      const sku = this.getRowField(row, 'sku', 'barcode', 'item_code', 'code');
      const mrpRaw = this.getRowField(row, 'mrp', 'max_retail_price', 'retail_price');
      const spRaw = this.getRowField(row, 'sellingPrice', 'selling_price', 'price', 'sp');
      const unitRaw = this.getRowField(row, 'unit', 'uom', 'measure');
      const weightRaw = this.getRowField(row, 'weight', 'size', 'pack_size', 'quantity');
      const descRaw = this.getRowField(row, 'description', 'desc');
      const initialStockRaw = this.getRowField(
        row,
        'initialStock',
        'initial_stock',
        'stock',
        'qty',
        'opening_stock',
      );
      const imageUrlRaw = this.getRowField(row, 'imageUrl', 'image_url', 'image', 'photo');
      const imagesRaw = this.getRowField(row, 'images', 'photos', 'gallery');

      if (!name) {
        errors.push({ row: rowNumber, reason: 'Product Name is missing' });
        continue;
      }
      if (!sku) {
        errors.push({ row: rowNumber, name: String(name), reason: 'SKU / Barcode is missing' });
        continue;
      }

      const formattedSku = String(sku).trim().toUpperCase();
      if (incomingSkusInFile.has(formattedSku)) {
        errors.push({
          row: rowNumber,
          sku: formattedSku,
          name: String(name),
          reason: `Duplicate SKU '${formattedSku}' found within the uploaded file`,
        });
        continue;
      }
      incomingSkusInFile.add(formattedSku);

      const mrp = parseFloat(mrpRaw);
      const sellingPrice = parseFloat(spRaw);
      const weight = parseFloat(weightRaw);
      const initialStock =
        initialStockRaw !== undefined && initialStockRaw !== '' ? parseInt(initialStockRaw, 10) : 0;

      if (isNaN(mrp) || mrp <= 0) {
        errors.push({
          row: rowNumber,
          sku: formattedSku,
          name: String(name),
          reason: `Invalid MRP value '${mrpRaw}'`,
        });
        continue;
      }
      if (isNaN(sellingPrice) || sellingPrice <= 0) {
        errors.push({
          row: rowNumber,
          sku: formattedSku,
          name: String(name),
          reason: `Invalid Selling Price value '${spRaw}'`,
        });
        continue;
      }
      if (sellingPrice > mrp) {
        errors.push({
          row: rowNumber,
          sku: formattedSku,
          name: String(name),
          reason: `Selling price (${sellingPrice}) cannot exceed MRP (${mrp})`,
        });
        continue;
      }
      if (isNaN(weight) || weight <= 0) {
        errors.push({
          row: rowNumber,
          sku: formattedSku,
          name: String(name),
          reason: `Invalid Weight value '${weightRaw}'`,
        });
        continue;
      }

      let unit: UnitOfMeasure;
      try {
        unit = this.normalizeUnit(unitRaw);
      } catch (e: any) {
        errors.push({ row: rowNumber, sku: formattedSku, name: String(name), reason: e.message });
        continue;
      }

      let imageList: string[] = [];
      if (imagesRaw) {
        if (Array.isArray(imagesRaw)) {
          imageList = imagesRaw.map(String).map((s) => s.trim()).filter(Boolean);
        } else if (typeof imagesRaw === 'string') {
          imageList = imagesRaw.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
        }
      }
      if (imageUrlRaw && !imageList.includes(String(imageUrlRaw).trim())) {
        imageList.unshift(String(imageUrlRaw).trim());
      }
      const primaryImageUrl =
        imageList.length > 0 ? imageList[0] : imageUrlRaw ? String(imageUrlRaw).trim() : null;

      validRowsToInsert.push({
        rowNumber,
        name: String(name).trim(),
        description: descRaw ? String(descRaw).trim() : null,
        sku: formattedSku,
        mrp,
        sellingPrice,
        unit,
        weight,
        initialStock: isNaN(initialStock) || initialStock < 0 ? 0 : initialStock,
        imageUrl: primaryImageUrl,
        images: imageList,
      });
    }

    if (validRowsToInsert.length > 0) {
      const skus = validRowsToInsert.map((r) => r.sku);
      const existingInDb = await this.prisma.productVariant.findMany({
        where: { sku: { in: skus } },
        select: { sku: true },
      });
      const dbSkuSet = new Set(existingInDb.map((v) => v.sku.toUpperCase()));

      const finalInsertList: typeof validRowsToInsert = [];
      for (const row of validRowsToInsert) {
        if (dbSkuSet.has(row.sku)) {
          errors.push({
            row: row.rowNumber,
            sku: row.sku,
            name: row.name,
            reason: `SKU '${row.sku}' already exists in database`,
          });
        } else {
          finalInsertList.push(row);
        }
      }

      const createdProducts: any[] = [];
      for (const item of finalInsertList) {
        try {
          const baseSlug = slugify(item.name);
          const slugCandidate = `${baseSlug}-${item.sku.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

          const existingSlug = await this.prisma.product.findUnique({ where: { slug: baseSlug } });
          const finalSlug = existingSlug ? slugCandidate : baseSlug;

          const product = await this.prisma.product.create({
            data: {
              name: item.name,
              slug: finalSlug,
              description: item.description,
              categoryId,
              brandId: brandId || null,
              imageUrl: item.imageUrl,
              images: item.images,
              isActive: true,
              variants: {
                create: {
                  sku: item.sku,
                  mrp: item.mrp,
                  sellingPrice: item.sellingPrice,
                  unit: item.unit,
                  weight: item.weight,
                  imageUrl: item.imageUrl,
                  images: item.images,
                  isActive: true,
                  inventory: {
                    create: {
                      quantityOnHand: item.initialStock,
                      isSellable: true,
                    },
                  },
                },
              },
            },
            include: PRODUCT_INCLUDE,
          });

          if (item.initialStock > 0 && product.variants[0]) {
            await this.prisma.inventoryTransaction.create({
              data: {
                variantId: product.variants[0].id,
                type: InventoryTransactionType.RECEIVE,
                onHandDelta: item.initialStock,
                reservedDelta: 0,
                balanceOnHandAfter: item.initialStock,
                balanceReservedAfter: 0,
                reason: 'Initial bulk import stock',
                performedBy: staffId || 'BULK_IMPORT',
              },
            });
          }

          createdProducts.push(this.formatProduct(product));
        } catch (dbErr: any) {
          errors.push({
            row: item.rowNumber,
            sku: item.sku,
            name: item.name,
            reason: dbErr.message || 'Failed to insert product into database',
          });
        }
      }

      return {
        total: rawRows.length,
        imported: createdProducts.length,
        failed: errors.length,
        errors,
        products: createdProducts,
      };
    }

    return {
      total: rawRows.length,
      imported: 0,
      failed: errors.length,
      errors,
      products: [],
    };
  }
}
