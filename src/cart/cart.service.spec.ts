import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CartService } from './cart.service';
import { PrismaService } from '../database/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { MAX_CART_ITEM_QUANTITY } from './cart.constants';

const mockPrismaService = {
  cartItem: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  productVariant: {
    findUnique: jest.fn(),
  },
};

const mockInventoryService = {
  getInventory: jest.fn(),
};

describe('CartService', () => {
  let service: CartService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: InventoryService, useValue: mockInventoryService },
      ],
    }).compile();

    service = module.get<CartService>(CartService);
  });

  describe('getCart', () => {
    it('computes line totals, grand total, and availability from live data', async () => {
      mockPrismaService.cartItem.findMany.mockResolvedValue([
        {
          id: 'item_1',
          variantId: 'var_1',
          quantity: 2,
          variant: {
            sku: 'SUGAR-1KG',
            unit: 'KG',
            weight: 1,
            sellingPrice: 52,
            mrp: 55,
            isActive: true,
            product: { id: 'prod_1', name: 'Tata Sugar', imageUrl: null, isActive: true },
          },
        },
      ]);
      mockInventoryService.getInventory.mockResolvedValue({ available: 10, isSellable: true });

      const result = await service.getCart('cust_1');

      expect(result.items[0].lineTotal).toBe(104);
      expect(result.items[0].isAvailable).toBe(true);
      expect(result.items[0].availableStock).toBe(10);
      expect(result.grandTotal).toBe(104);
    });

    it('marks an item unavailable when its product/variant has been retired', async () => {
      mockPrismaService.cartItem.findMany.mockResolvedValue([
        {
          id: 'item_1',
          variantId: 'var_1',
          quantity: 1,
          variant: {
            sku: 'X',
            unit: 'KG',
            weight: 1,
            sellingPrice: 10,
            mrp: 10,
            isActive: false,
            product: { id: 'prod_1', name: 'Retired Item', imageUrl: null, isActive: true },
          },
        },
      ]);
      mockInventoryService.getInventory.mockResolvedValue({ available: 5, isSellable: true });

      const result = await service.getCart('cust_1');

      expect(result.items[0].isAvailable).toBe(false);
    });
  });

  describe('addItem', () => {
    const activeVariant = {
      id: 'var_1',
      isActive: true,
      product: { isActive: true },
    };

    it('creates a new line when the item is not already in the cart', async () => {
      mockPrismaService.productVariant.findUnique.mockResolvedValue(activeVariant);
      mockPrismaService.cartItem.findUnique.mockResolvedValue(null);
      mockPrismaService.cartItem.upsert.mockResolvedValue({ id: 'item_1', quantity: 3 });

      await service.addItem('cust_1', { variantId: 'var_1', quantity: 3 });

      expect(mockPrismaService.cartItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { quantity: 3 } }),
      );
    });

    it('increases quantity when the item is already in the cart', async () => {
      mockPrismaService.productVariant.findUnique.mockResolvedValue(activeVariant);
      mockPrismaService.cartItem.findUnique.mockResolvedValue({ id: 'item_1', quantity: 2 });
      mockPrismaService.cartItem.upsert.mockResolvedValue({ id: 'item_1', quantity: 5 });

      await service.addItem('cust_1', { variantId: 'var_1', quantity: 3 });

      expect(mockPrismaService.cartItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { quantity: 5 } }),
      );
    });

    it('caps the combined quantity at the maximum instead of growing without bound', async () => {
      mockPrismaService.productVariant.findUnique.mockResolvedValue(activeVariant);
      mockPrismaService.cartItem.findUnique.mockResolvedValue({
        id: 'item_1',
        quantity: MAX_CART_ITEM_QUANTITY - 1,
      });
      mockPrismaService.cartItem.upsert.mockResolvedValue({ id: 'item_1' });

      await service.addItem('cust_1', { variantId: 'var_1', quantity: 10 });

      expect(mockPrismaService.cartItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { quantity: MAX_CART_ITEM_QUANTITY } }),
      );
    });

    it('rejects a variant that no longer exists', async () => {
      mockPrismaService.productVariant.findUnique.mockResolvedValue(null);

      await expect(
        service.addItem('cust_1', { variantId: 'missing', quantity: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a variant that has been retired', async () => {
      mockPrismaService.productVariant.findUnique.mockResolvedValue({
        id: 'var_1',
        isActive: false,
        product: { isActive: true },
      });

      await expect(service.addItem('cust_1', { variantId: 'var_1', quantity: 1 })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('updateItem / removeItem', () => {
    it('throws NotFoundException when the cart item does not belong to this customer', async () => {
      mockPrismaService.cartItem.findFirst.mockResolvedValue(null);

      await expect(service.updateItem('cust_1', 'item_1', { quantity: 2 })).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.removeItem('cust_1', 'item_1')).rejects.toThrow(NotFoundException);
    });

    it('updates the quantity when the item belongs to the customer', async () => {
      mockPrismaService.cartItem.findFirst.mockResolvedValue({
        id: 'item_1',
        customerId: 'cust_1',
      });
      mockPrismaService.cartItem.update.mockResolvedValue({ id: 'item_1', quantity: 4 });

      await service.updateItem('cust_1', 'item_1', { quantity: 4 });

      expect(mockPrismaService.cartItem.update).toHaveBeenCalledWith({
        where: { id: 'item_1' },
        data: { quantity: 4 },
      });
    });
  });
});
