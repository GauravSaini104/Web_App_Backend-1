import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AffiliateEarningStatus,
  AffiliateEarningType,
  AffiliatePayoutStatus,
  AffiliateStatus,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { handlePrismaError } from '../common/utils/prisma-error.util';
import { slugify } from '../common/utils/slugify';
import {
  DEFAULT_COMMISSION_RATE,
  DEFAULT_HOLD_DAYS,
  DEFAULT_MIN_PAYOUT_AMOUNT,
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
} from './affiliates.constants';
import { calculateBalances, checkReconciliation } from './affiliates.ledger';
import { ApplyAffiliateDto } from './dto/apply-affiliate.dto';
import { UpdateAffiliateProfileDto } from './dto/update-affiliate-profile.dto';
import { RequestPayoutDto } from './dto/request-payout.dto';
import { ReviewAffiliateDto } from './dto/review-affiliate.dto';
import { ReviewPayoutDto } from './dto/review-payout.dto';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { QueryAffiliatesDto } from './dto/query-affiliates.dto';
import { AffiliateStatsQueryDto } from './dto/affiliate-stats-query.dto';
import { QueryEarningsDto } from './dto/query-earnings.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Injectable()
export class AffiliatesService {
  private readonly logger = new Logger(AffiliatesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Settings Singleton
  // ---------------------------------------------------------------------------

  async getOrCreateSettings() {
    return await this.prisma.affiliateSettings.upsert({
      where: { id: 1 },
      update: {},
      create: {
        id: 1,
        commissionRate: new Prisma.Decimal(DEFAULT_COMMISSION_RATE),
        minPayoutAmount: new Prisma.Decimal(DEFAULT_MIN_PAYOUT_AMOUNT),
        holdDays: DEFAULT_HOLD_DAYS,
        isProgrammeOpen: true,
      },
    });
  }

  async updateSettings(dto: UpdateSettingsDto) {
    await this.getOrCreateSettings();
    return await this.prisma.affiliateSettings.update({
      where: { id: 1 },
      data: {
        ...(dto.commissionRate !== undefined && {
          commissionRate: new Prisma.Decimal(dto.commissionRate),
        }),
        ...(dto.minPayoutAmount !== undefined && {
          minPayoutAmount: new Prisma.Decimal(dto.minPayoutAmount),
        }),
        ...(dto.holdDays !== undefined && { holdDays: dto.holdDays }),
        ...(dto.isProgrammeOpen !== undefined && { isProgrammeOpen: dto.isProgrammeOpen }),
        ...(dto.termsVersion !== undefined && { termsVersion: dto.termsVersion }),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Referral Code Generation
  // ---------------------------------------------------------------------------

  private generateRandomCode(length: number): string {
    let result = '';
    const chars = REFERRAL_CODE_ALPHABET;
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async generateReferralCode(baseText?: string): Promise<string> {
    const cleanBase = baseText
      ? slugify(baseText).toUpperCase().replace(/[AEIOU]/g, '').replace(/[^A-Z0-9]/g, '')
      : '';
    const prefix = cleanBase.slice(0, 4);

    for (let attempt = 0; attempt < 5; attempt++) {
      const randomPart = this.generateRandomCode(REFERRAL_CODE_LENGTH - prefix.length);
      const candidate = (prefix + randomPart).slice(0, REFERRAL_CODE_LENGTH);

      const existing = await this.prisma.affiliateProfile.findUnique({
        where: { referralCode: candidate },
      });
      if (!existing) {
        return candidate;
      }
    }

    // Fallback to pure random 8 chars
    while (true) {
      const candidate = this.generateRandomCode(REFERRAL_CODE_LENGTH);
      const existing = await this.prisma.affiliateProfile.findUnique({
        where: { referralCode: candidate },
      });
      if (!existing) {
        return candidate;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Customer Flows
  // ---------------------------------------------------------------------------

  async getApplyEligibility(customerId: string) {
    const settings = await this.getOrCreateSettings();
    const profile = await this.prisma.affiliateProfile.findUnique({
      where: { customerId },
    });

    return {
      isProgrammeOpen: settings.isProgrammeOpen,
      commissionRate: Number(settings.commissionRate),
      minPayoutAmount: Number(settings.minPayoutAmount),
      holdDays: settings.holdDays,
      payoutCycleNote: 'Payouts are processed manually via UPI within 3–5 working days.',
      hasApplied: !!profile,
      status: profile?.status ?? null,
      referralCode: profile?.referralCode ?? null,
      canApply: settings.isProgrammeOpen && (!profile || profile.status === AffiliateStatus.REJECTED),
    };
  }

  async applyAffiliate(customerId: string, dto: ApplyAffiliateDto) {
    const settings = await this.getOrCreateSettings();
    if (!settings.isProgrammeOpen) {
      throw new ForbiddenException('The affiliate programme is currently closed to new applications');
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const existing = await this.prisma.affiliateProfile.findUnique({
      where: { customerId },
    });

    if (existing) {
      if (existing.status === AffiliateStatus.PENDING) {
        throw new BadRequestException('You have already applied to the affiliate programme');
      }
      if (existing.status === AffiliateStatus.APPROVED) {
        throw new BadRequestException('You are already an approved affiliate');
      }
      if (existing.status === AffiliateStatus.SUSPENDED) {
        throw new ForbiddenException('Your affiliate account is currently suspended');
      }

      // If REJECTED -> re-apply resets to PENDING and updates answers, preserving referral code
      return await this.prisma.affiliateProfile.update({
        where: { id: existing.id },
        data: {
          status: AffiliateStatus.PENDING,
          primaryChannel: dto.primaryChannel,
          channelUrl: dto.channelUrl ?? null,
          audienceSize: dto.audienceSize ?? null,
          motivation: dto.motivation,
          upiId: dto.upiId ?? existing.upiId,
          upiName: dto.upiName ?? existing.upiName,
          rejectionReason: null,
          reviewedAt: null,
          reviewedById: null,
        },
      });
    }

    const referralCode = await this.generateReferralCode(customer.name || customer.phone);

    try {
      return await this.prisma.affiliateProfile.create({
        data: {
          customerId,
          referralCode,
          primaryChannel: dto.primaryChannel,
          channelUrl: dto.channelUrl ?? null,
          audienceSize: dto.audienceSize ?? null,
          motivation: dto.motivation,
          upiId: dto.upiId ?? null,
          upiName: dto.upiName ?? null,
          status: AffiliateStatus.PENDING,
        },
      });
    } catch (error) {
      handlePrismaError(error, 'Affiliate application');
    }
  }

  async getMe(customerId: string) {
    const profile = await this.prisma.affiliateProfile.findUnique({
      where: { customerId },
      include: {
        earnings: { select: { amount: true, type: true, status: true } },
        payouts: { select: { amount: true, status: true } },
      },
    });

    if (!profile) {
      throw new NotFoundException('Affiliate profile not found');
    }

    const balances = calculateBalances(profile.earnings, profile.payouts);
    const settings = await this.getOrCreateSettings();

    return {
      id: profile.id,
      status: profile.status,
      referralCode: profile.referralCode,
      upiId: profile.upiId,
      upiName: profile.upiName,
      primaryChannel: profile.primaryChannel,
      channelUrl: profile.channelUrl,
      rejectionReason: profile.rejectionReason,
      createdAt: profile.createdAt,
      commissionRate: Number(settings.commissionRate),
      minPayoutAmount: Number(settings.minPayoutAmount),
      balances,
    };
  }

  async updateMe(customerId: string, dto: UpdateAffiliateProfileDto) {
    const profile = await this.prisma.affiliateProfile.findUnique({
      where: { customerId },
    });
    if (!profile) {
      throw new NotFoundException('Affiliate profile not found');
    }

    return await this.prisma.affiliateProfile.update({
      where: { id: profile.id },
      data: {
        ...(dto.upiId !== undefined && { upiId: dto.upiId }),
        ...(dto.upiName !== undefined && { upiName: dto.upiName }),
      },
    });
  }

  async getMeEarnings(customerId: string, query: QueryEarningsDto) {
    const profile = await this.prisma.affiliateProfile.findUnique({
      where: { customerId },
    });
    if (!profile) {
      throw new NotFoundException('Affiliate profile not found');
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.AffiliateEarningWhereInput = {
      affiliateId: profile.id,
      ...(query.type && { type: query.type }),
      ...(query.status && { status: query.status }),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from && { gte: new Date(query.from) }),
              ...(query.to && { lte: new Date(query.to) }),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.affiliateEarning.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          order: {
            select: {
              id: true,
              orderNumber: true,
              status: true,
              subtotal: true,
            },
          },
        },
      }),
      this.prisma.affiliateEarning.count({ where }),
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getMeStats(customerId: string, dto: AffiliateStatsQueryDto) {
    const profile = await this.prisma.affiliateProfile.findUnique({
      where: { customerId },
      include: {
        earnings: { select: { amount: true, type: true, status: true, createdAt: true } },
        payouts: { select: { amount: true, status: true, requestedAt: true } },
      },
    });
    if (!profile) {
      throw new NotFoundException('Affiliate profile not found');
    }

    const balances = calculateBalances(profile.earnings, profile.payouts);

    const now = new Date();
    let startDate: Date | null = null;
    if (dto.range === '7d') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (dto.range === '30d') {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (dto.range === '90d') {
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    }

    const orderWhere: Prisma.OrderWhereInput = {
      affiliateId: profile.id,
      status: OrderStatus.COMPLETED,
      ...(startDate && { createdAt: { gte: startDate } }),
    };

    const [orders, referredCustomersCount] = await Promise.all([
      this.prisma.order.findMany({
        where: orderWhere,
        select: {
          id: true,
          subtotal: true,
          createdAt: true,
          items: {
            select: {
              productName: true,
              quantity: true,
              lineTotal: true,
            },
          },
        },
      }),
      this.prisma.customer.count({
        where: {
          referredByAffiliateId: profile.id,
          ...(startDate && { referredAt: { gte: startDate } }),
        },
      }),
    ]);

    let grossRevenue = 0;
    const productSalesMap = new Map<string, { quantity: number; revenue: number }>();

    for (const order of orders) {
      grossRevenue += Number(order.subtotal);
      for (const item of order.items) {
        const existing = productSalesMap.get(item.productName) || { quantity: 0, revenue: 0 };
        existing.quantity += item.quantity;
        existing.revenue += Number(item.lineTotal);
        productSalesMap.set(item.productName, existing);
      }
    }

    const topProducts = Array.from(productSalesMap.entries())
      .map(([name, data]) => ({
        name,
        quantity: data.quantity,
        revenue: Math.round(data.revenue * 100) / 100,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    return {
      range: dto.range || '30d',
      grossRevenue: Math.round(grossRevenue * 100) / 100,
      ordersCount: orders.length,
      referredCustomersCount,
      balances,
      topProducts,
    };
  }

  async getMePayouts(customerId: string, query?: PaginationQueryDto) {
    const profile = await this.prisma.affiliateProfile.findUnique({
      where: { customerId },
    });
    if (!profile) {
      throw new NotFoundException('Affiliate profile not found');
    }

    const page = query?.page ?? 1;
    const limit = query?.limit ?? 20;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.affiliatePayout.findMany({
        where: { affiliateId: profile.id },
        orderBy: { requestedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.affiliatePayout.count({
        where: { affiliateId: profile.id },
      }),
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async requestPayout(customerId: string, dto: RequestPayoutDto) {
    const profile = await this.prisma.affiliateProfile.findUnique({
      where: { customerId },
      include: {
        earnings: { select: { amount: true, type: true, status: true } },
        payouts: { select: { amount: true, status: true } },
      },
    });

    if (!profile) {
      throw new NotFoundException('Affiliate profile not found');
    }
    if (profile.status === AffiliateStatus.SUSPENDED) {
      throw new ForbiddenException('Suspended affiliates cannot request payouts');
    }
    if (profile.status !== AffiliateStatus.APPROVED) {
      throw new ForbiddenException('Only approved affiliates can request payouts');
    }
    if (!profile.upiId) {
      throw new BadRequestException('Please set up your UPI ID before requesting a payout');
    }

    const settings = await this.getOrCreateSettings();
    const minPayout = Number(settings.minPayoutAmount);
    const balances = calculateBalances(profile.earnings, profile.payouts);

    if (dto.amount < minPayout) {
      throw new BadRequestException(`Minimum payout amount is ₹${minPayout.toFixed(2)}`);
    }
    if (dto.amount > balances.availableBalance) {
      throw new BadRequestException('Payout amount exceeds your available balance');
    }

    return await this.prisma.$transaction(async (tx) => {
      const payout = await tx.affiliatePayout.create({
        data: {
          affiliateId: profile.id,
          amount: new Prisma.Decimal(dto.amount),
          upiId: profile.upiId!,
          status: AffiliatePayoutStatus.REQUESTED,
          notes: dto.note ?? null,
        },
      });

      // Immediately deduct from available ledger balance to prevent double requests
      await tx.affiliateEarning.create({
        data: {
          affiliateId: profile.id,
          amount: new Prisma.Decimal(-dto.amount),
          type: AffiliateEarningType.PAYOUT,
          status: AffiliateEarningStatus.AVAILABLE,
          description: `Payout #${payout.id.slice(-6)} requested`,
        },
      });

      return payout;
    });
  }

  async getMeReferrals(customerId: string, query: PaginationQueryDto) {
    const profile = await this.prisma.affiliateProfile.findUnique({
      where: { customerId },
    });
    if (!profile) {
      throw new NotFoundException('Affiliate profile not found');
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [customers, total] = await Promise.all([
      this.prisma.customer.findMany({
        where: { referredByAffiliateId: profile.id },
        orderBy: { referredAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          phone: true,
          name: true,
          referredAt: true,
          orders: {
            where: { status: OrderStatus.COMPLETED },
            select: { subtotal: true },
          },
        },
      }),
      this.prisma.customer.count({
        where: { referredByAffiliateId: profile.id },
      }),
    ]);

    const items = customers.map((c) => {
      // Mask phone number (e.g. +91 98****1234)
      const phone = c.phone;
      const maskedPhone =
        phone.length > 6
          ? `${phone.slice(0, 4)}****${phone.slice(-3)}`
          : '****';

      const ordersCount = c.orders.length;
      const totalSpend = c.orders.reduce((sum, o) => sum + Number(o.subtotal), 0);

      return {
        id: c.id,
        name: c.name || 'Anonymous Customer',
        phone: maskedPhone,
        referredAt: c.referredAt,
        ordersCount,
        totalSpend: Math.round(totalSpend * 100) / 100,
      };
    });

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Public Route
  // ---------------------------------------------------------------------------

  async resolveReferralCode(code: string) {
    if (!code) {
      throw new BadRequestException('Referral code is required');
    }

    const profile = await this.prisma.affiliateProfile.findFirst({
      where: {
        referralCode: { equals: code.trim(), mode: 'insensitive' },
        status: AffiliateStatus.APPROVED,
      },
      include: {
        customer: { select: { name: true } },
      },
    });

    if (!profile) {
      throw new NotFoundException('Referral code not found or inactive');
    }

    return {
      valid: true,
      referralCode: profile.referralCode,
      affiliateDisplayName: profile.customer?.name || 'Affiliate Partner',
    };
  }

  // ---------------------------------------------------------------------------
  // Integration Hooks (Used by Auth & Orders modules)
  // ---------------------------------------------------------------------------

  async resolveApprovedAffiliateId(referralCode: string): Promise<string | null> {
    if (!referralCode) return null;
    const profile = await this.prisma.affiliateProfile.findFirst({
      where: {
        referralCode: { equals: referralCode.trim(), mode: 'insensitive' },
        status: AffiliateStatus.APPROVED,
      },
      select: { id: true },
    });
    return profile ? profile.id : null;
  }

  async getAffiliateIfActive(affiliateId: string): Promise<string | null> {
    if (!affiliateId) return null;
    const profile = await this.prisma.affiliateProfile.findUnique({
      where: { id: affiliateId },
      select: { status: true },
    });
    return profile?.status === AffiliateStatus.APPROVED ? affiliateId : null;
  }

  /**
   * Idempotently books commission on completed order.
   */
  async bookCommissionForOrder(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        affiliateId: true,
        subtotal: true,
        status: true,
      },
    });

    if (!order || !order.affiliateId || order.status !== OrderStatus.COMPLETED) {
      return;
    }

    // Check if commission was already booked
    const existing = await this.prisma.affiliateEarning.findFirst({
      where: { orderId: order.id },
    });
    if (existing) {
      return;
    }

    const settings = await this.getOrCreateSettings();
    const rate = Number(settings.commissionRate);
    const subtotal = Number(order.subtotal);
    const commissionAmount = Math.round(((subtotal * rate) / 100) * 100) / 100;

    if (commissionAmount <= 0) {
      return;
    }

    const holdDays = settings.holdDays;
    const isPending = holdDays > 0;
    const availableAt = isPending
      ? new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000)
      : new Date();

    await this.prisma.affiliateEarning.create({
      data: {
        affiliateId: order.affiliateId,
        orderId: order.id,
        amount: new Prisma.Decimal(commissionAmount),
        type: AffiliateEarningType.COMMISSION,
        status: isPending ? AffiliateEarningStatus.PENDING : AffiliateEarningStatus.AVAILABLE,
        baseAmount: new Prisma.Decimal(subtotal),
        rateApplied: new Prisma.Decimal(rate),
        description: `Commission on order #${order.orderNumber}`,
        availableAt,
      },
    });

    this.logger.log(
      `Booked commission ₹${commissionAmount} for affiliate ${order.affiliateId} on order #${order.orderNumber}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Staff Admin Operations
  // ---------------------------------------------------------------------------

  async findAllAffiliates(query: QueryAffiliatesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.AffiliateProfileWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.channel && { primaryChannel: query.channel }),
      ...(query.search && {
        OR: [
          { referralCode: { contains: query.search, mode: 'insensitive' } },
          { upiId: { contains: query.search, mode: 'insensitive' } },
          { upiName: { contains: query.search, mode: 'insensitive' } },
          { customer: { phone: { contains: query.search } } },
          { customer: { name: { contains: query.search, mode: 'insensitive' } } },
        ],
      }),
    };

    const [profiles, total] = await Promise.all([
      this.prisma.affiliateProfile.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          earnings: { select: { amount: true, type: true, status: true } },
          payouts: { select: { amount: true, status: true } },
          _count: {
            select: {
              referredCustomers: true,
              orders: { where: { status: OrderStatus.COMPLETED } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.affiliateProfile.count({ where }),
    ]);

    const items = profiles.map((p) => {
      const balances = calculateBalances(p.earnings, p.payouts);
      return {
        id: p.id,
        customerId: p.customerId,
        customerName: p.customer.name,
        customerPhone: p.customer.phone,
        status: p.status,
        referralCode: p.referralCode,
        upiId: p.upiId,
        upiName: p.upiName,
        primaryChannel: p.primaryChannel,
        channelUrl: p.channelUrl,
        audienceSize: p.audienceSize,
        motivation: p.motivation,
        rejectionReason: p.rejectionReason,
        staffNotes: p.staffNotes,
        createdAt: p.createdAt,
        referredCount: p._count.referredCustomers,
        completedOrdersCount: p._count.orders,
        balances,
      };
    });

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOneAffiliate(id: string) {
    const profile = await this.prisma.affiliateProfile.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, phone: true, createdAt: true } },
        earnings: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            order: { select: { id: true, orderNumber: true, subtotal: true } },
            createdBy: { select: { id: true, displayName: true } },
          },
        },
        payouts: {
          orderBy: { requestedAt: 'desc' },
          take: 20,
          include: {
            processedBy: { select: { id: true, displayName: true } },
          },
        },
        _count: {
          select: {
            referredCustomers: true,
            orders: { where: { status: OrderStatus.COMPLETED } },
          },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('Affiliate profile not found');
    }

    const allEarnings = await this.prisma.affiliateEarning.findMany({
      where: { affiliateId: profile.id },
      select: { amount: true, type: true, status: true },
    });
    const allPayouts = await this.prisma.affiliatePayout.findMany({
      where: { affiliateId: profile.id },
      select: { amount: true, status: true },
    });

    const balances = calculateBalances(allEarnings, allPayouts);

    return {
      ...profile,
      balances,
    };
  }

  async updateAffiliateStatus(id: string, dto: ReviewAffiliateDto, staffId: string) {
    const profile = await this.prisma.affiliateProfile.findUnique({
      where: { id },
    });
    if (!profile) {
      throw new NotFoundException('Affiliate profile not found');
    }

    if (dto.status === AffiliateStatus.REJECTED && !dto.rejectionReason) {
      throw new BadRequestException('Rejection reason is required when rejecting an application');
    }

    return await this.prisma.affiliateProfile.update({
      where: { id },
      data: {
        status: dto.status,
        reviewedAt: new Date(),
        reviewedById: staffId,
        ...(dto.rejectionReason !== undefined && { rejectionReason: dto.rejectionReason }),
        ...(dto.staffNotes !== undefined && { staffNotes: dto.staffNotes }),
      },
    });
  }

  async findAllPayouts(query: PaginationQueryDto & { status?: AffiliatePayoutStatus }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.AffiliatePayoutWhereInput = {
      ...(query.status && { status: query.status }),
    };

    const [items, total] = await Promise.all([
      this.prisma.affiliatePayout.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        skip,
        take: limit,
        include: {
          affiliate: {
            select: {
              id: true,
              referralCode: true,
              upiId: true,
              upiName: true,
              customer: { select: { id: true, name: true, phone: true } },
            },
          },
          processedBy: { select: { id: true, displayName: true } },
        },
      }),
      this.prisma.affiliatePayout.count({ where }),
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async reviewPayout(payoutId: string, dto: ReviewPayoutDto, staffId: string) {
    const payout = await this.prisma.affiliatePayout.findUnique({
      where: { id: payoutId },
    });
    if (!payout) {
      throw new NotFoundException('Payout request not found');
    }
    if (payout.status !== AffiliatePayoutStatus.REQUESTED) {
      throw new BadRequestException('This payout has already been processed');
    }

    if (dto.status === AffiliatePayoutStatus.PAID && !dto.transactionRef) {
      throw new BadRequestException('Transaction reference (UTR) is required when marking payout as paid');
    }
    if (dto.status === AffiliatePayoutStatus.REJECTED && !dto.rejectionReason) {
      throw new BadRequestException('Rejection reason is required when rejecting a payout');
    }

    return await this.prisma.$transaction(async (tx) => {
      const updatedPayout = await tx.affiliatePayout.update({
        where: { id: payoutId },
        data: {
          status: dto.status,
          processedAt: new Date(),
          processedById: staffId,
          ...(dto.transactionRef && { transactionRef: dto.transactionRef }),
          ...(dto.staffNote && { notes: dto.staffNote }),
          ...(dto.rejectionReason && { rejectionReason: dto.rejectionReason }),
        },
      });

      // If rejected, refund the deducted amount back to available balance via an ADJUSTMENT row
      if (dto.status === AffiliatePayoutStatus.REJECTED) {
        const matchingPayoutEarning = await tx.affiliateEarning.findFirst({
          where: {
            affiliateId: payout.affiliateId,
            type: AffiliateEarningType.PAYOUT,
            description: { contains: payout.id.slice(-6) },
          },
        });

        await tx.affiliateEarning.create({
          data: {
            affiliateId: payout.affiliateId,
            amount: payout.amount, // positive refund
            type: AffiliateEarningType.ADJUSTMENT,
            status: AffiliateEarningStatus.AVAILABLE,
            reversesEarningId: matchingPayoutEarning ? matchingPayoutEarning.id : null,
            description: `Payout #${payout.id.slice(-6)} rejected refund: ${dto.rejectionReason || 'Staff rejected'}`,
            createdById: staffId,
          },
        });
      }

      return updatedPayout;
    });
  }

  async createAdjustment(affiliateId: string, dto: CreateAdjustmentDto, staffId: string) {
    const profile = await this.prisma.affiliateProfile.findUnique({
      where: { id: affiliateId },
    });
    if (!profile) {
      throw new NotFoundException('Affiliate profile not found');
    }

    return await this.prisma.affiliateEarning.create({
      data: {
        affiliateId,
        amount: new Prisma.Decimal(dto.amount),
        type: AffiliateEarningType.ADJUSTMENT,
        status: AffiliateEarningStatus.AVAILABLE,
        description: dto.reason,
        createdById: staffId,
      },
    });
  }

  async getReconciliation() {
    const [earnings, payouts] = await Promise.all([
      this.prisma.affiliateEarning.findMany({
        select: { amount: true, type: true, status: true },
      }),
      this.prisma.affiliatePayout.findMany({
        select: { amount: true, status: true },
      }),
    ]);

    const balances = calculateBalances(earnings, payouts);
    const recon = checkReconciliation(balances);

    return {
      balances,
      reconciliation: recon,
    };
  }

  async getStaffStats() {
    const [
      pendingApplications,
      approvedAffiliates,
      payoutsAwaiting,
      earnings,
      payouts,
      attributedOrders,
    ] = await Promise.all([
      this.prisma.affiliateProfile.count({
        where: { status: AffiliateStatus.PENDING },
      }),
      this.prisma.affiliateProfile.count({
        where: { status: AffiliateStatus.APPROVED },
      }),
      this.prisma.affiliatePayout.count({
        where: { status: AffiliatePayoutStatus.REQUESTED },
      }),
      this.prisma.affiliateEarning.findMany({
        select: { amount: true, type: true, status: true },
      }),
      this.prisma.affiliatePayout.findMany({
        select: { amount: true, status: true },
      }),
      this.prisma.order.findMany({
        where: {
          affiliateId: { not: null },
          status: OrderStatus.COMPLETED,
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
        select: { subtotal: true },
      }),
    ]);

    const balances = calculateBalances(earnings, payouts);
    const thirtyDayRevenue = attributedOrders.reduce(
      (sum, o) => sum + Number(o.subtotal),
      0,
    );

    return {
      pendingApplications,
      approvedAffiliates,
      payoutsAwaiting,
      commissionLiability: balances.availableBalance + balances.pendingBalance,
      thirtyDayRevenue: Math.round(thirtyDayRevenue * 100) / 100,
      balances,
    };
  }
}
