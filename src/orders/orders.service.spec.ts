import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FulfillmentMethod, OrderStatus, PaymentMethod } from '@prisma/client';
import { OrdersService } from './orders.service';
import { PrismaService } from '../database/prisma.service';
import { InventoryService } from '../inventory/inventory.service';

const mockConfigService = {
  get: jest.fn((key: string) => {
    if (key === 'DELIVERY_FEE') return '20';
    if (key === 'FREE_DELIVERY_THRESHOLD') return '199';
    return undefined;
  }),
};

const mockTx = {
  order: { create: jest.fn(), update: jest.fn() },
  cartItem: { deleteMany: jest.fn() },
  stockReservation: { findMany: jest.fn() },
};

const mockPrismaService = {
  cartItem: { findMany: jest.fn() },
  address: { findFirst: jest.fn() },
  order: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  $transaction: jest.fn((callback: (tx: typeof mockTx) => unknown) => callback(mockTx)),
};

const mockInventoryService = {
  reserveStockTx: jest.fn(),
  releaseReservationTx: jest.fn(),
};

function cartItem(overrides: Partial<any> = {}) {
  return {
    id: 'ci_1',
    variantId: 'var_1',
    quantity: 2,
    variant: {
      id: 'var_1',
      sku: 'SUGAR-1KG',
      unit: 'KG',
      weight: 1,
      sellingPrice: 52,
      isActive: true,
      product: { id: 'prod_1', name: 'Tata Sugar', isActive: true },
    },
    ...overrides,
  };
}

describe('OrdersService', () => {
  let service: OrdersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrismaService.$transaction.mockImplementation((callback: (tx: typeof mockTx) => unknown) =>
      callback(mockTx),
    );
    mockTx.order.create.mockResolvedValue({ id: 'order_1', items: [] });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: InventoryService, useValue: mockInventoryService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  describe('createOrder', () => {
    const pickupCash = {
      fulfillmentMethod: FulfillmentMethod.PICKUP,
      paymentMethod: PaymentMethod.CASH,
    };

    it('rejects checkout with an empty cart', async () => {
      mockPrismaService.cartItem.findMany.mockResolvedValue([]);

      await expect(service.createOrder('cust_1', pickupCash as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects checkout when a cart item has been retired', async () => {
      mockPrismaService.cartItem.findMany.mockResolvedValue([
        cartItem({ variant: { ...cartItem().variant, isActive: false } }),
      ]);

      await expect(service.createOrder('cust_1', pickupCash as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('requires a valid address for delivery orders', async () => {
      mockPrismaService.cartItem.findMany.mockResolvedValue([cartItem()]);
      mockPrismaService.address.findFirst.mockResolvedValue(null);

      await expect(
        service.createOrder('cust_1', {
          fulfillmentMethod: FulfillmentMethod.DELIVERY,
          paymentMethod: PaymentMethod.CASH,
          addressId: 'addr_missing',
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('CASH orders start CONFIRMED — no online payment step to wait for', async () => {
      mockPrismaService.cartItem.findMany.mockResolvedValue([cartItem()]);
      mockInventoryService.reserveStockTx.mockResolvedValue({});

      await service.createOrder('cust_1', pickupCash as any);

      expect(mockTx.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: OrderStatus.CONFIRMED }),
        }),
      );
    });

    it('UPI orders start PENDING_PAYMENT', async () => {
      mockPrismaService.cartItem.findMany.mockResolvedValue([cartItem()]);
      mockInventoryService.reserveStockTx.mockResolvedValue({});

      await service.createOrder('cust_1', {
        fulfillmentMethod: FulfillmentMethod.PICKUP,
        paymentMethod: PaymentMethod.UPI,
      } as any);

      expect(mockTx.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: OrderStatus.PENDING_PAYMENT }),
        }),
      );
    });

    it('PICKUP orders are never charged a delivery fee, regardless of order size', async () => {
      mockPrismaService.cartItem.findMany.mockResolvedValue([cartItem()]); // subtotal = 104, below threshold
      mockInventoryService.reserveStockTx.mockResolvedValue({});

      await service.createOrder('cust_1', pickupCash as any);

      expect(mockTx.order.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deliveryFee: 0 }) }),
      );
    });

    it('charges the configured delivery fee for a DELIVERY order below the free threshold', async () => {
      mockPrismaService.cartItem.findMany.mockResolvedValue([cartItem()]); // subtotal = 104 < 199
      mockPrismaService.address.findFirst.mockResolvedValue({
        id: 'addr_1',
        label: 'Home',
        line1: 'X',
        line2: null,
        city: 'Bhopal',
        state: 'MP',
        pincode: '462001',
      });
      mockInventoryService.reserveStockTx.mockResolvedValue({});

      await service.createOrder('cust_1', {
        fulfillmentMethod: FulfillmentMethod.DELIVERY,
        paymentMethod: PaymentMethod.CASH,
        addressId: 'addr_1',
      } as any);

      expect(mockTx.order.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deliveryFee: 20 }) }),
      );
    });

    it('waives the delivery fee for a DELIVERY order at or above the free threshold', async () => {
      mockPrismaService.cartItem.findMany.mockResolvedValue([cartItem({ quantity: 4 })]); // subtotal = 208 >= 199
      mockPrismaService.address.findFirst.mockResolvedValue({
        id: 'addr_1',
        label: 'Home',
        line1: 'X',
        line2: null,
        city: 'Bhopal',
        state: 'MP',
        pincode: '462001',
      });
      mockInventoryService.reserveStockTx.mockResolvedValue({});

      await service.createOrder('cust_1', {
        fulfillmentMethod: FulfillmentMethod.DELIVERY,
        paymentMethod: PaymentMethod.CASH,
        addressId: 'addr_1',
      } as any);

      expect(mockTx.order.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deliveryFee: 0 }) }),
      );
    });

    it('reserves stock for every cart item and then clears the cart', async () => {
      mockPrismaService.cartItem.findMany.mockResolvedValue([
        cartItem({ variantId: 'var_1' }),
        cartItem({ id: 'ci_2', variantId: 'var_2' }),
      ]);
      mockInventoryService.reserveStockTx.mockResolvedValue({});

      await service.createOrder('cust_1', pickupCash as any);

      expect(mockInventoryService.reserveStockTx).toHaveBeenCalledTimes(2);
      expect(mockTx.cartItem.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'cust_1' } });
    });

    it('rolls back the whole checkout if any single item cannot be reserved', async () => {
      mockPrismaService.cartItem.findMany.mockResolvedValue([
        cartItem({ variantId: 'var_1' }),
        cartItem({ id: 'ci_2', variantId: 'var_2' }),
      ]);
      mockInventoryService.reserveStockTx
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new BadRequestException('Only 0 unit(s) available'));

      await expect(service.createOrder('cust_1', pickupCash as any)).rejects.toThrow(
        BadRequestException,
      );
      // Cart must NOT be cleared if checkout failed partway through.
      expect(mockTx.cartItem.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('cancelOrder', () => {
    it('throws NotFoundException for an order that does not belong to this customer', async () => {
      mockPrismaService.order.findFirst.mockResolvedValue(null);

      await expect(service.cancelOrder('cust_1', 'order_1', {})).rejects.toThrow(NotFoundException);
    });

    it('rejects cancelling an order that is already READY', async () => {
      mockPrismaService.order.findFirst.mockResolvedValue({
        id: 'order_1',
        status: OrderStatus.READY,
      });

      await expect(service.cancelOrder('cust_1', 'order_1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('releases active reservations and marks the order cancelled', async () => {
      mockPrismaService.order.findFirst.mockResolvedValue({
        id: 'order_1',
        status: OrderStatus.CONFIRMED,
      });
      mockTx.stockReservation.findMany.mockResolvedValue([{ id: 'res_1' }, { id: 'res_2' }]);
      mockInventoryService.releaseReservationTx.mockResolvedValue({});
      mockTx.order.update.mockResolvedValue({ id: 'order_1', status: OrderStatus.CANCELLED });

      await service.cancelOrder('cust_1', 'order_1', { reason: 'changed my mind' });

      expect(mockInventoryService.releaseReservationTx).toHaveBeenCalledTimes(2);
      expect(mockTx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: OrderStatus.CANCELLED }),
        }),
      );
    });
  });

  describe('updateStatus', () => {
    it('throws NotFoundException when the order does not exist', async () => {
      mockPrismaService.order.findUnique.mockResolvedValue(null);

      await expect(service.updateStatus('order_1', { status: OrderStatus.PACKED })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects an invalid forward transition', async () => {
      mockPrismaService.order.findUnique.mockResolvedValue({
        id: 'order_1',
        status: OrderStatus.PENDING_PAYMENT,
      });

      await expect(service.updateStatus('order_1', { status: OrderStatus.READY })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('allows a valid forward transition', async () => {
      mockPrismaService.order.findUnique.mockResolvedValue({
        id: 'order_1',
        status: OrderStatus.CONFIRMED,
      });
      mockPrismaService.order.update.mockResolvedValue({
        id: 'order_1',
        status: OrderStatus.PACKED,
      });

      await service.updateStatus('order_1', { status: OrderStatus.PACKED });

      expect(mockPrismaService.order.update).toHaveBeenCalledWith({
        where: { id: 'order_1' },
        data: { status: OrderStatus.PACKED },
      });
    });
  });

  describe('confirmPayment', () => {
    it('rejects confirming payment on an order that is not PENDING_PAYMENT', async () => {
      mockPrismaService.order.findUnique.mockResolvedValue({
        id: 'order_1',
        status: OrderStatus.CONFIRMED,
      });

      await expect(service.confirmPayment('order_1')).rejects.toThrow(BadRequestException);
    });

    it('confirms payment on a PENDING_PAYMENT order', async () => {
      mockPrismaService.order.findUnique.mockResolvedValue({
        id: 'order_1',
        status: OrderStatus.PENDING_PAYMENT,
      });
      mockPrismaService.order.update.mockResolvedValue({
        id: 'order_1',
        status: OrderStatus.CONFIRMED,
      });

      await service.confirmPayment('order_1');

      expect(mockPrismaService.order.update).toHaveBeenCalledWith({
        where: { id: 'order_1' },
        data: { status: OrderStatus.CONFIRMED },
      });
    });
  });

  describe('expireAbandonedOrders', () => {
    it('cancels a PENDING_PAYMENT order whose reservation has expired', async () => {
      mockPrismaService.order.findMany.mockResolvedValue([
        {
          id: 'order_1',
          stockReservations: [{ status: 'ACTIVE', expiresAt: new Date(Date.now() - 60_000) }],
        },
      ]);
      mockTx.stockReservation.findMany.mockResolvedValue([]);
      mockTx.order.update.mockResolvedValue({ id: 'order_1', status: OrderStatus.CANCELLED });

      const result = await service.expireAbandonedOrders();

      expect(mockTx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order_1' },
          data: expect.objectContaining({ status: OrderStatus.CANCELLED }),
        }),
      );
      expect(result).toEqual({ cancelledCount: 1 });
    });

    it('leaves a PENDING_PAYMENT order alone while its reservation is still active', async () => {
      mockPrismaService.order.findMany.mockResolvedValue([
        {
          id: 'order_1',
          stockReservations: [{ status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000) }],
        },
      ]);

      const result = await service.expireAbandonedOrders();

      expect(mockTx.order.update).not.toHaveBeenCalled();
      expect(result).toEqual({ cancelledCount: 0 });
    });
  });
});
