import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../database/prisma.service';
import { OrdersService } from '../orders/orders.service';

const WEBHOOK_SECRET = 'test-webhook-secret';

const mockPrismaService = {
  order: { findFirst: jest.fn() },
  payment: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
};

const mockOrdersService = { confirmPayment: jest.fn() };

describe('PaymentsService', () => {
  let service: PaymentsService;
  let configValues: Record<string, string | undefined>;
  const mockConfigService = { get: jest.fn((key: string) => configValues[key]) };

  beforeEach(async () => {
    jest.clearAllMocks();
    configValues = {
      PAYMENT_PROVIDER: 'razorpay',
      RAZORPAY_KEY_ID: 'rzp_test_key',
      RAZORPAY_KEY_SECRET: 'rzp_test_secret',
      RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: OrdersService, useValue: mockOrdersService },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  describe('isConfigured', () => {
    it('is false when PAYMENT_PROVIDER is unset', () => {
      configValues.PAYMENT_PROVIDER = undefined;
      expect(service.isConfigured()).toBe(false);
    });

    it('is true when provider and both Razorpay keys are set', () => {
      expect(service.isConfigured()).toBe(true);
    });
  });

  describe('initiatePayment', () => {
    it('refuses to run when the gateway is not configured', async () => {
      configValues.PAYMENT_PROVIDER = undefined;

      await expect(service.initiatePayment('cust_1', 'order_1')).rejects.toThrow();
    });

    it('throws NotFoundException for an order that does not belong to this customer', async () => {
      mockPrismaService.order.findFirst.mockResolvedValue(null);

      await expect(service.initiatePayment('cust_1', 'order_1')).rejects.toThrow(NotFoundException);
    });

    it('rejects a CASH order — it never needs online payment', async () => {
      mockPrismaService.order.findFirst.mockResolvedValue({
        id: 'order_1',
        paymentMethod: PaymentMethod.CASH,
        status: OrderStatus.PENDING_PAYMENT,
      });

      await expect(service.initiatePayment('cust_1', 'order_1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an order that is not awaiting payment', async () => {
      mockPrismaService.order.findFirst.mockResolvedValue({
        id: 'order_1',
        paymentMethod: PaymentMethod.UPI,
        status: OrderStatus.CONFIRMED,
      });

      await expect(service.initiatePayment('cust_1', 'order_1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('creates a Razorpay order and a Payment row for a valid UPI order', async () => {
      mockPrismaService.order.findFirst.mockResolvedValue({
        id: 'order_1',
        paymentMethod: PaymentMethod.UPI,
        status: OrderStatus.PENDING_PAYMENT,
        subtotal: 260,
        deliveryFee: 20,
      });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'order_razorpay_1',
          amount: 28000,
          currency: 'INR',
          status: 'created',
        }),
      }) as unknown as typeof fetch;
      mockPrismaService.payment.create.mockResolvedValue({ id: 'payment_1' });

      const result = await service.initiatePayment('cust_1', 'order_1');

      expect(mockPrismaService.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ providerOrderId: 'order_razorpay_1', amount: 280 }),
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          providerOrderId: 'order_razorpay_1',
          amount: 280,
          keyId: 'rzp_test_key',
        }),
      );
    });
  });

  describe('handleWebhook', () => {
    function sign(body: string) {
      return createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
    }

    it('rejects a webhook with a missing signature', async () => {
      const rawBody = Buffer.from('{}');
      await expect(service.handleWebhook(rawBody, undefined, {} as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a webhook with a tampered signature', async () => {
      const rawBody = Buffer.from('{"event":"payment.captured"}');
      const wrongSignature = sign('{"event":"something else"}');

      await expect(
        service.handleWebhook(rawBody, wrongSignature, { event: 'payment.captured' } as any),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('accepts a correctly signed payment.captured event and confirms the order', async () => {
      const body = {
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_1', order_id: 'order_razorpay_1' } } },
      };
      const rawBody = Buffer.from(JSON.stringify(body));
      const signature = sign(rawBody.toString());

      mockPrismaService.payment.findUnique.mockResolvedValue({
        id: 'payment_1',
        orderId: 'order_1',
        status: PaymentStatus.CREATED,
      });

      await service.handleWebhook(rawBody, signature, body as any);

      expect(mockPrismaService.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: PaymentStatus.SUCCESS }),
        }),
      );
      expect(mockOrdersService.confirmPayment).toHaveBeenCalledWith('order_1');
    });

    it('is idempotent — a payment already resolved is not reprocessed', async () => {
      const body = {
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_1', order_id: 'order_razorpay_1' } } },
      };
      const rawBody = Buffer.from(JSON.stringify(body));
      const signature = sign(rawBody.toString());

      mockPrismaService.payment.findUnique.mockResolvedValue({
        id: 'payment_1',
        orderId: 'order_1',
        status: PaymentStatus.SUCCESS, // already handled by an earlier delivery
      });

      await service.handleWebhook(rawBody, signature, body as any);

      expect(mockPrismaService.payment.update).not.toHaveBeenCalled();
      expect(mockOrdersService.confirmPayment).not.toHaveBeenCalled();
    });

    it('marks a failed payment without touching the order (retry is allowed)', async () => {
      const body = {
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_1',
              order_id: 'order_razorpay_1',
              error_description: 'Insufficient funds',
            },
          },
        },
      };
      const rawBody = Buffer.from(JSON.stringify(body));
      const signature = sign(rawBody.toString());

      mockPrismaService.payment.findUnique.mockResolvedValue({
        id: 'payment_1',
        orderId: 'order_1',
        status: PaymentStatus.CREATED,
      });

      await service.handleWebhook(rawBody, signature, body as any);

      expect(mockPrismaService.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: PaymentStatus.FAILED,
            failureReason: 'Insufficient funds',
          }),
        }),
      );
      expect(mockOrdersService.confirmPayment).not.toHaveBeenCalled();
    });
  });
});
