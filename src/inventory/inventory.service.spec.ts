import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../database/prisma.service';

/**
 * Mocks Prisma's interactive `$transaction(async (tx) => ...)` pattern by
 * invoking the callback with a fake `tx` client. This lets us test each
 * transaction's internal logic (the lock-check-write sequence) without a
 * real database — true concurrent-request behavior is verified separately
 * against the real Postgres instance.
 */
const mockTx = {
  $queryRaw: jest.fn(),
  stockReservation: {
    create: jest.fn(),
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    aggregate: jest.fn(),
  },
  inventory: {
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
  },
  inventoryTransaction: {
    create: jest.fn(),
  },
};

const mockPrismaService = {
  inventory: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  stockReservation: {
    findMany: jest.fn(),
    aggregate: jest.fn(),
  },
  inventoryTransaction: {
    findMany: jest.fn(),
  },
  $transaction: jest.fn((callback: (tx: typeof mockTx) => unknown) => callback(mockTx)),
};

describe('InventoryService', () => {
  let service: InventoryService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrismaService.$transaction.mockImplementation((callback: (tx: typeof mockTx) => unknown) =>
      callback(mockTx),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [InventoryService, { provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
  });

  describe('getInventory', () => {
    it('computes available stock and low/out-of-stock flags', async () => {
      mockPrismaService.inventory.findUnique.mockResolvedValue({
        variantId: 'var_1',
        quantityOnHand: 20,
        lowStockThreshold: 5,
        isSellable: true,
      });
      mockPrismaService.stockReservation.aggregate.mockResolvedValue({ _sum: { quantity: 3 } });

      const result = await service.getInventory('var_1');

      expect(result.available).toBe(17);
      expect(result.isOutOfStock).toBe(false);
      expect(result.isLowStock).toBe(false);
    });

    it('flags low stock using the platform default when no per-variant threshold is set', async () => {
      mockPrismaService.inventory.findUnique.mockResolvedValue({
        variantId: 'var_1',
        quantityOnHand: 4,
        lowStockThreshold: null,
        isSellable: true,
      });
      mockPrismaService.stockReservation.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });

      const result = await service.getInventory('var_1');

      expect(result.available).toBe(4);
      expect(result.isLowStock).toBe(true); // default threshold is 5
    });

    it('throws NotFoundException when the variant has no inventory record', async () => {
      mockPrismaService.inventory.findUnique.mockResolvedValue(null);

      await expect(service.getInventory('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('reserveStock', () => {
    it('creates a reservation when enough stock is available', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ id: 'inv_1', quantityOnHand: 10, isSellable: true }]);
      mockTx.stockReservation.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
      mockTx.stockReservation.create.mockResolvedValue({
        id: 'res_1',
        variantId: 'var_1',
        quantity: 7,
      });

      const result = await service.reserveStock('var_1', { quantity: 7, orderId: 'order_1' });

      expect(result).toEqual({ id: 'res_1', variantId: 'var_1', quantity: 7 });
      expect(mockTx.inventoryTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'RESERVE', reservedDelta: 7 }),
        }),
      );
    });

    it('rejects when the requested quantity exceeds what is available (the overselling guard)', async () => {
      // onHand=10, already 7 reserved elsewhere -> only 3 available
      mockTx.$queryRaw.mockResolvedValue([{ id: 'inv_1', quantityOnHand: 10, isSellable: true }]);
      mockTx.stockReservation.aggregate.mockResolvedValue({ _sum: { quantity: 7 } });

      await expect(service.reserveStock('var_1', { quantity: 5 })).rejects.toThrow(
        BadRequestException,
      );
      expect(mockTx.stockReservation.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the variant has no inventory record', async () => {
      mockTx.$queryRaw.mockResolvedValue([]);

      await expect(service.reserveStock('missing', { quantity: 1 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects when the item has been manually marked not sellable', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ id: 'inv_1', quantityOnHand: 100, isSellable: false }]);

      await expect(service.reserveStock('var_1', { quantity: 1 })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('releaseReservation', () => {
    it('releases an active reservation and logs the transaction', async () => {
      mockTx.stockReservation.updateMany.mockResolvedValue({ count: 1 });
      mockTx.stockReservation.findUniqueOrThrow.mockResolvedValue({
        id: 'res_1',
        variantId: 'var_1',
        quantity: 4,
        orderId: null,
      });
      mockTx.inventory.findUniqueOrThrow.mockResolvedValue({ quantityOnHand: 20 });
      mockTx.stockReservation.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });

      await service.releaseReservation('res_1');

      expect(mockTx.inventoryTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'RELEASE', reservedDelta: -4 }),
        }),
      );
    });

    it('rejects releasing a reservation that is already handled', async () => {
      mockTx.stockReservation.updateMany.mockResolvedValue({ count: 0 });
      mockTx.stockReservation.findUnique.mockResolvedValue({ id: 'res_1', status: 'CONSUMED' });

      await expect(service.releaseReservation('res_1')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the reservation does not exist', async () => {
      mockTx.stockReservation.updateMany.mockResolvedValue({ count: 0 });
      mockTx.stockReservation.findUnique.mockResolvedValue(null);

      await expect(service.releaseReservation('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('consumeReservation', () => {
    it('decrements onHand and marks the reservation consumed', async () => {
      mockTx.stockReservation.findUnique.mockResolvedValue({
        id: 'res_1',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 60_000),
      });
      mockTx.stockReservation.updateMany.mockResolvedValue({ count: 1 });
      mockTx.stockReservation.findUniqueOrThrow.mockResolvedValue({
        id: 'res_1',
        variantId: 'var_1',
        quantity: 2,
        orderId: 'order_1',
      });
      mockTx.$queryRaw.mockResolvedValue([{ quantityOnHand: 20 }]);
      mockTx.stockReservation.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });

      await service.consumeReservation('res_1');

      expect(mockTx.inventory.update).toHaveBeenCalledWith({
        where: { variantId: 'var_1' },
        data: { quantityOnHand: 18 },
      });
      expect(mockTx.inventoryTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'SALE', onHandDelta: -2 }),
        }),
      );
    });

    it('rejects consuming a reservation that has already expired', async () => {
      mockTx.stockReservation.findUnique.mockResolvedValue({
        id: 'res_1',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() - 60_000),
      });

      await expect(service.consumeReservation('res_1')).rejects.toThrow(BadRequestException);
      expect(mockTx.stockReservation.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('receiveStock', () => {
    it('increases onHand and logs a RECEIVE transaction', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ quantityOnHand: 10 }]);
      mockTx.stockReservation.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });

      await service.receiveStock('var_1', {
        quantity: 50,
        reason: 'Supplier delivery',
        performedBy: 'Ramesh',
      });

      expect(mockTx.inventory.update).toHaveBeenCalledWith({
        where: { variantId: 'var_1' },
        data: { quantityOnHand: 60 },
      });
    });
  });

  describe('writeOffStock', () => {
    it('rejects writing off more than is currently on hand', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ quantityOnHand: 3 }]);

      await expect(
        service.writeOffStock('var_1', { quantity: 10, reason: 'Damaged', performedBy: 'Ramesh' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockTx.inventory.update).not.toHaveBeenCalled();
    });
  });
});
