import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { PrismaService } from '../database/prisma.service';

/**
 * A fake stand-in for PrismaService. Unit tests should not hit a real
 * database — that would make them slow and flaky. This mock lets us
 * control exactly what the "database" returns for each test.
 */
const mockPrismaService = {
  product: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  productVariant: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  inventory: {
    findMany: jest.fn(),
  },
  stockReservation: {
    groupBy: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('ProductsService', () => {
  let service: ProductsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // attachAvailability's two batch queries — most tests don't care about
    // stock, so default them to "nothing found" unless a test overrides.
    mockPrismaService.inventory.findMany.mockResolvedValue([]);
    mockPrismaService.stockReservation.groupBy.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductsService, { provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  describe('create', () => {
    const validDto = {
      name: 'Tata Sugar',
      categoryId: 'cat_1',
      variants: [{ sku: 'SUGAR-1KG', mrp: 55, sellingPrice: 52, unit: 'KG', weight: 1 }],
    };

    it('creates a product with its variants and auto-generates a slug when none is given', async () => {
      mockPrismaService.product.create.mockResolvedValue({ id: 'prod_1', ...validDto });

      const result = await service.create(validDto as any);

      expect(mockPrismaService.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            slug: 'tata-sugar',
            variants: { create: [expect.objectContaining({ sku: 'SUGAR-1KG' })] },
          }),
        }),
      );
      expect(result).toEqual({ id: 'prod_1', ...validDto });
    });

    it('rejects the whole product if any variant has sellingPrice greater than mrp', async () => {
      const invalidDto = {
        ...validDto,
        variants: [{ sku: 'SUGAR-1KG', mrp: 50, sellingPrice: 80, unit: 'KG', weight: 1 }],
      };

      await expect(service.create(invalidDto as any)).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.product.create).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns the product when found', async () => {
      const product = { id: 'prod_1', name: 'Tata Sugar', variants: [] };
      mockPrismaService.product.findUnique.mockResolvedValue(product);

      const result = await service.findOne('prod_1');

      expect(result).toEqual(product);
    });

    it('throws NotFoundException when the product does not exist', async () => {
      mockPrismaService.product.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });

    it('marks a variant available when in stock and sellable', async () => {
      mockPrismaService.product.findUnique.mockResolvedValue({
        id: 'prod_1',
        variants: [{ id: 'var_1' }],
      });
      mockPrismaService.inventory.findMany.mockResolvedValue([
        { variantId: 'var_1', quantityOnHand: 10, isSellable: true, lowStockThreshold: null },
      ]);
      mockPrismaService.stockReservation.groupBy.mockResolvedValue([]);

      const result = await service.findOne('prod_1');

      expect(result.variants[0]).toEqual(
        expect.objectContaining({ isAvailable: true, isLowStock: false }),
      );
    });

    it('marks a variant unavailable when marked not sellable, even with stock on hand', async () => {
      mockPrismaService.product.findUnique.mockResolvedValue({
        id: 'prod_1',
        variants: [{ id: 'var_1' }],
      });
      mockPrismaService.inventory.findMany.mockResolvedValue([
        { variantId: 'var_1', quantityOnHand: 10, isSellable: false, lowStockThreshold: null },
      ]);
      mockPrismaService.stockReservation.groupBy.mockResolvedValue([]);

      const result = await service.findOne('prod_1');

      expect(result.variants[0].isAvailable).toBe(false);
    });

    it('marks a variant unavailable once active reservations consume all remaining stock', async () => {
      mockPrismaService.product.findUnique.mockResolvedValue({
        id: 'prod_1',
        variants: [{ id: 'var_1' }],
      });
      mockPrismaService.inventory.findMany.mockResolvedValue([
        { variantId: 'var_1', quantityOnHand: 5, isSellable: true, lowStockThreshold: null },
      ]);
      mockPrismaService.stockReservation.groupBy.mockResolvedValue([
        { variantId: 'var_1', _sum: { quantity: 5 } },
      ]);

      const result = await service.findOne('prod_1');

      expect(result.variants[0].isAvailable).toBe(false);
    });

    it('flags low stock using the product-specific threshold when set', async () => {
      mockPrismaService.product.findUnique.mockResolvedValue({
        id: 'prod_1',
        variants: [{ id: 'var_1' }],
      });
      mockPrismaService.inventory.findMany.mockResolvedValue([
        { variantId: 'var_1', quantityOnHand: 3, isSellable: true, lowStockThreshold: 10 },
      ]);
      mockPrismaService.stockReservation.groupBy.mockResolvedValue([]);

      const result = await service.findOne('prod_1');

      expect(result.variants[0]).toEqual(
        expect.objectContaining({ isAvailable: true, isLowStock: true }),
      );
    });
  });

  describe('findBySku', () => {
    it('returns the variant (with its parent product) when the SKU exists', async () => {
      const variant = { id: 'var_1', sku: 'SUGAR-1KG', product: { name: 'Tata Sugar' } };
      mockPrismaService.productVariant.findUnique.mockResolvedValue(variant);

      const result = await service.findBySku('SUGAR-1KG');

      expect(result).toEqual({ ...variant, isAvailable: false, isLowStock: false });
    });

    it('throws NotFoundException when no variant has that SKU', async () => {
      mockPrismaService.productVariant.findUnique.mockResolvedValue(null);

      await expect(service.findBySku('UNKNOWN')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('paginates results and returns pagination metadata', async () => {
      const items = [
        { id: 'prod_1', variants: [] },
        { id: 'prod_2', variants: [] },
      ];
      mockPrismaService.$transaction.mockResolvedValue([items, 42]);

      const result = await service.findAll({ page: 2, limit: 2 } as any);

      expect(result.items).toEqual(items);
      expect(result.meta).toEqual({ total: 42, page: 2, limit: 2, totalPages: 21 });
    });
  });

  describe('remove', () => {
    it('soft-deletes the product and all its variants instead of erasing rows', async () => {
      mockPrismaService.product.findUnique.mockResolvedValue({ id: 'prod_1', variants: [] });
      mockPrismaService.$transaction.mockResolvedValue([{}, {}]);

      await service.remove('prod_1');

      expect(mockPrismaService.product.update).toHaveBeenCalledWith({
        where: { id: 'prod_1' },
        data: { isActive: false },
      });
      expect(mockPrismaService.productVariant.updateMany).toHaveBeenCalledWith({
        where: { productId: 'prod_1' },
        data: { isActive: false },
      });
      expect(mockPrismaService.product.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the product does not exist', async () => {
      mockPrismaService.product.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('addVariant', () => {
    it('adds a new pack size to an existing product', async () => {
      mockPrismaService.product.findUnique.mockResolvedValue({ id: 'prod_1', variants: [] });
      const dto = { sku: 'SUGAR-5KG', mrp: 260, sellingPrice: 250, unit: 'KG', weight: 5 };
      mockPrismaService.productVariant.create.mockResolvedValue({ id: 'var_2', ...dto });

      const result = await service.addVariant('prod_1', dto as any);

      expect(result).toEqual({ id: 'var_2', ...dto });
    });

    it('rejects a new variant with sellingPrice greater than mrp', async () => {
      mockPrismaService.product.findUnique.mockResolvedValue({ id: 'prod_1', variants: [] });
      const dto = { sku: 'BAD', mrp: 50, sellingPrice: 60, unit: 'KG', weight: 1 };

      await expect(service.addVariant('prod_1', dto as any)).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.productVariant.create).not.toHaveBeenCalled();
    });
  });

  describe('updateVariant', () => {
    it('rejects an update that would push sellingPrice above the existing mrp', async () => {
      mockPrismaService.productVariant.findFirst.mockResolvedValue({
        id: 'var_1',
        productId: 'prod_1',
        mrp: 55,
        sellingPrice: 52,
      });

      await expect(
        service.updateVariant('prod_1', 'var_1', { sellingPrice: 999 } as any),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.productVariant.update).not.toHaveBeenCalled();
    });
  });

  describe('removeVariant', () => {
    it('refuses to deactivate the only remaining active pack size on a product', async () => {
      mockPrismaService.productVariant.findFirst.mockResolvedValue({
        id: 'var_1',
        productId: 'prod_1',
        isActive: true,
      });
      mockPrismaService.productVariant.count.mockResolvedValue(0);

      await expect(service.removeVariant('prod_1', 'var_1')).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.productVariant.update).not.toHaveBeenCalled();
      expect(mockPrismaService.productVariant.delete).not.toHaveBeenCalled();
    });

    it('deactivates a pack size (does not erase it) when other active sizes still exist', async () => {
      mockPrismaService.productVariant.findFirst.mockResolvedValue({
        id: 'var_1',
        productId: 'prod_1',
        isActive: true,
      });
      mockPrismaService.productVariant.count.mockResolvedValue(1);

      await service.removeVariant('prod_1', 'var_1');

      expect(mockPrismaService.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'var_1' },
        data: { isActive: false },
      });
      expect(mockPrismaService.productVariant.delete).not.toHaveBeenCalled();
    });

    it('is a harmless no-op when the variant is already inactive, even if it is the only one', async () => {
      mockPrismaService.productVariant.findFirst.mockResolvedValue({
        id: 'var_1',
        productId: 'prod_1',
        isActive: false,
      });

      await service.removeVariant('prod_1', 'var_1');

      expect(mockPrismaService.productVariant.count).not.toHaveBeenCalled();
      expect(mockPrismaService.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'var_1' },
        data: { isActive: false },
      });
    });

    it('throws NotFoundException when the variant does not belong to the product', async () => {
      mockPrismaService.productVariant.findFirst.mockResolvedValue(null);

      await expect(service.removeVariant('prod_1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });
});
