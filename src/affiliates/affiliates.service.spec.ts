import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  AffiliateEarningStatus,
  AffiliateEarningType,
  AffiliatePayoutStatus,
  AffiliateStatus,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { AffiliatesService } from './affiliates.service';
import { PrismaService } from '../database/prisma.service';
import { calculateBalances, checkReconciliation } from './affiliates.ledger';

const mockSettings = {
  id: 1,
  commissionRate: new Prisma.Decimal(5.0),
  minPayoutAmount: new Prisma.Decimal(500.0),
  holdDays: 0,
  isProgrammeOpen: true,
  termsVersion: '1.0',
  updatedAt: new Date(),
};

const mockCustomer = {
  id: 'cust-1',
  phone: '9876543210',
  name: 'Test Customer',
  isPhoneVerified: true,
};

const mockProfile = {
  id: 'aff-1',
  customerId: 'cust-1',
  referralCode: 'TEST1234',
  status: AffiliateStatus.APPROVED,
  upiId: 'test@upi',
  upiName: 'Test User',
  primaryChannel: 'instagram',
  channelUrl: 'https://instagram.com/test',
  audienceSize: '10k',
  motivation: 'I love promoting great grocery products to my audience!',
  rejectionReason: null,
  staffNotes: null,
  reviewedAt: new Date(),
  reviewedById: 'staff-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  customer: mockCustomer,
  earnings: [],
  payouts: [],
};

const mockPrismaService = {
  affiliateSettings: {
    upsert: jest.fn(),
    update: jest.fn(),
  },
  affiliateProfile: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  affiliateEarning: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
  },
  affiliatePayout: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  customer: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  order: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('AffiliatesService', () => {
  let service: AffiliatesService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AffiliatesService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<AffiliatesService>(AffiliatesService);
  });

  describe('Ledger Invariant & Math', () => {
    it('should maintain zero-delta reconciliation across earnings, payouts, and reversals', () => {
      const earnings = [
        { amount: 50.0, type: AffiliateEarningType.COMMISSION, status: AffiliateEarningStatus.AVAILABLE },
        { amount: 100.0, type: AffiliateEarningType.COMMISSION, status: AffiliateEarningStatus.AVAILABLE },
        { amount: -100.0, type: AffiliateEarningType.PAYOUT, status: AffiliateEarningStatus.AVAILABLE },
        { amount: 100.0, type: AffiliateEarningType.ADJUSTMENT, status: AffiliateEarningStatus.AVAILABLE, reversesEarningId: 'payout-1' }, // rejected payout refund
      ];
      const payouts = [
        { amount: 100.0, status: AffiliatePayoutStatus.REJECTED },
      ];

      const balances = calculateBalances(earnings, payouts);
      expect(balances.availableBalance).toBe(150.0);
      expect(balances.lifetimeEarned).toBe(150.0);
      expect(balances.lifetimeAdjustments).toBe(0.0); // reversal doesn't inflate genuine adjustments
      expect(balances.lifetimePaid).toBe(0.0);

      const recon = checkReconciliation(balances);
      expect(recon.isBalanced).toBe(true);
      expect(recon.delta).toBe(0.0);
    });
  });

  describe('getApplyEligibility', () => {
    it('should return eligibility details for a customer who has not applied', async () => {
      mockPrismaService.affiliateSettings.upsert.mockResolvedValue(mockSettings);
      mockPrismaService.affiliateProfile.findUnique.mockResolvedValue(null);

      const result = await service.getApplyEligibility('cust-1');
      expect(result.isProgrammeOpen).toBe(true);
      expect(result.hasApplied).toBe(false);
      expect(result.canApply).toBe(true);
      expect(result.commissionRate).toBe(5.0);
    });
  });

  describe('requestPayout', () => {
    it('should reject payout if amount exceeds available balance', async () => {
      mockPrismaService.affiliateProfile.findUnique.mockResolvedValue({
        ...mockProfile,
        earnings: [
          { amount: new Prisma.Decimal(200.0), type: AffiliateEarningType.COMMISSION, status: AffiliateEarningStatus.AVAILABLE },
        ],
        payouts: [],
      });
      mockPrismaService.affiliateSettings.upsert.mockResolvedValue(mockSettings);

      await expect(
        service.requestPayout('cust-1', { amount: 600.0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject payout if affiliate is suspended', async () => {
      mockPrismaService.affiliateProfile.findUnique.mockResolvedValue({
        ...mockProfile,
        status: AffiliateStatus.SUSPENDED,
      });

      await expect(
        service.requestPayout('cust-1', { amount: 500.0 }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('bookCommissionForOrder', () => {
    it('should idempotently book commission on completed order with global fallback rate', async () => {
      mockPrismaService.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        orderNumber: 1042,
        affiliateId: 'aff-1',
        subtotal: new Prisma.Decimal(1000.0),
        status: OrderStatus.COMPLETED,
      });
      mockPrismaService.affiliateProfile.findUnique.mockResolvedValue({
        customCommissionRate: null,
      });
      mockPrismaService.affiliateEarning.findFirst.mockResolvedValue(null);
      mockPrismaService.affiliateSettings.upsert.mockResolvedValue(mockSettings);
      mockPrismaService.affiliateEarning.create.mockResolvedValue({});
      mockPrismaService.order.update.mockResolvedValue({});

      await service.bookCommissionForOrder('ord-1');

      expect(mockPrismaService.affiliateEarning.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            affiliateId: 'aff-1',
            orderId: 'ord-1',
            amount: new Prisma.Decimal(50.0), // 5% of 1000
            rateApplied: new Prisma.Decimal(5.0),
            type: AffiliateEarningType.COMMISSION,
            status: AffiliateEarningStatus.AVAILABLE,
          }),
        }),
      );
    });

    it('should book commission with customCommissionRate when set on affiliate profile', async () => {
      mockPrismaService.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        orderNumber: 1042,
        affiliateId: 'aff-1',
        subtotal: new Prisma.Decimal(1000.0),
        status: OrderStatus.COMPLETED,
      });
      mockPrismaService.affiliateProfile.findUnique.mockResolvedValue({
        customCommissionRate: new Prisma.Decimal(8.5),
      });
      mockPrismaService.affiliateEarning.findFirst.mockResolvedValue(null);
      mockPrismaService.affiliateSettings.upsert.mockResolvedValue(mockSettings);
      mockPrismaService.affiliateEarning.create.mockResolvedValue({});
      mockPrismaService.order.update.mockResolvedValue({});

      await service.bookCommissionForOrder('ord-1');

      expect(mockPrismaService.affiliateEarning.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            affiliateId: 'aff-1',
            orderId: 'ord-1',
            amount: new Prisma.Decimal(85.0), // 8.5% of 1000
            rateApplied: new Prisma.Decimal(8.5),
            type: AffiliateEarningType.COMMISSION,
            status: AffiliateEarningStatus.AVAILABLE,
          }),
        }),
      );
    });

    it('should skip if commission was already booked for this orderId', async () => {
      mockPrismaService.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        orderNumber: 1042,
        affiliateId: 'aff-1',
        subtotal: new Prisma.Decimal(1000.0),
        status: OrderStatus.COMPLETED,
      });
      mockPrismaService.affiliateEarning.findFirst.mockResolvedValue({ id: 'earn-1' });

      await service.bookCommissionForOrder('ord-1');

      expect(mockPrismaService.affiliateEarning.create).not.toHaveBeenCalled();
    });
  });

  describe('updateAffiliateCommission', () => {
    it('should update custom commission rate on affiliate profile', async () => {
      mockPrismaService.affiliateProfile.findUnique.mockResolvedValue(mockProfile);
      mockPrismaService.affiliateSettings.upsert.mockResolvedValue(mockSettings);
      mockPrismaService.affiliateProfile.update.mockResolvedValue({
        ...mockProfile,
        customCommissionRate: new Prisma.Decimal(10.0),
        updatedAt: new Date(),
      });

      const result = await service.updateAffiliateCommission('aff-1', {
        customCommissionRate: 10.0,
      });

      expect(result.customCommissionRate).toBe(10.0);
      expect(result.effectiveCommissionRate).toBe(10.0);
      expect(result.isCustomRate).toBe(true);
      expect(mockPrismaService.affiliateProfile.update).toHaveBeenCalledWith({
        where: { id: 'aff-1' },
        data: { customCommissionRate: new Prisma.Decimal(10.0) },
      });
    });

    it('should reset custom commission rate to null when null is provided', async () => {
      mockPrismaService.affiliateProfile.findUnique.mockResolvedValue(mockProfile);
      mockPrismaService.affiliateSettings.upsert.mockResolvedValue(mockSettings);
      mockPrismaService.affiliateProfile.update.mockResolvedValue({
        ...mockProfile,
        customCommissionRate: null,
        updatedAt: new Date(),
      });

      const result = await service.updateAffiliateCommission('aff-1', {
        customCommissionRate: null,
      });

      expect(result.customCommissionRate).toBeNull();
      expect(result.effectiveCommissionRate).toBe(5.0); // global fallback
      expect(result.isCustomRate).toBe(false);
      expect(mockPrismaService.affiliateProfile.update).toHaveBeenCalledWith({
        where: { id: 'aff-1' },
        data: { customCommissionRate: null },
      });
    });

    it('should throw BadRequestException when customCommissionRate is undefined', async () => {
      await expect(
        service.updateAffiliateCommission('aff-1', {} as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when affiliate profile is not found', async () => {
      mockPrismaService.affiliateProfile.findUnique.mockResolvedValue(null);
      await expect(
        service.updateAffiliateCommission('aff-unknown', { customCommissionRate: 10 }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
