import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FulfillmentMethod, OrderStatus, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { ALLOWED_STATUS_TRANSITIONS, CUSTOMER_CANCELLABLE_STATUSES } from './orders.constants';

const ORDER_INCLUDE = { items: true } as const;
const ORDER_INCLUDE_WITH_CUSTOMER = { items: true, customer: true } as const;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Checkout. Everything happens in one database transaction: create the
   * order + frozen line-item snapshots, reserve stock for every item
   * atomically (all-or-nothing across the whole cart, not per item), then
   * clear the cart — so a failure partway through leaves no trace of a
   * broken order or a half-reserved cart.
   */
  async createOrder(customerId: string, dto: CreateOrderDto) {
    const cartItems = await this.prisma.cartItem.findMany({
      where: { customerId },
      include: { variant: { include: { product: true } } },
    });

    if (cartItems.length === 0) {
      throw new BadRequestException('Your cart is empty');
    }

    for (const item of cartItems) {
      if (!item.variant.isActive || !item.variant.product.isActive) {
        throw new BadRequestException(
          `"${item.variant.product.name}" is no longer available — remove it from your cart to continue`,
        );
      }
    }

    let deliverySnapshot: Record<string, string | null> = {};
    if (dto.fulfillmentMethod === FulfillmentMethod.DELIVERY) {
      if (!dto.addressId) {
        throw new BadRequestException('addressId is required for delivery orders');
      }
      const address = await this.prisma.address.findFirst({
        where: { id: dto.addressId, customerId },
      });
      if (!address) {
        throw new NotFoundException('Delivery address not found');
      }
      deliverySnapshot = {
        deliveryLabel: address.label,
        deliveryLine1: address.line1,
        deliveryLine2: address.line2,
        deliveryCity: address.city,
        deliveryState: address.state,
        deliveryPincode: address.pincode,
      };
    }

    const lineItems = cartItems.map((item) => {
      const unitPrice = Number(item.variant.sellingPrice);
      const lineTotal = Number((unitPrice * item.quantity).toFixed(2));
      return { item, unitPrice, lineTotal };
    });
    const subtotal = Number(lineItems.reduce((sum, x) => sum + x.lineTotal, 0).toFixed(2));
    const deliveryFee = this.calculateDeliveryFee(dto.fulfillmentMethod, subtotal);

    // CASH orders have no online-payment step to wait for; UPI orders sit
    // in PENDING_PAYMENT until the gateway confirms (Step 6).
    const initialStatus =
      dto.paymentMethod === PaymentMethod.CASH
        ? OrderStatus.CONFIRMED
        : OrderStatus.PENDING_PAYMENT;

    return this.prisma
      .$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            customerId,
            status: initialStatus,
            paymentMethod: dto.paymentMethod,
            fulfillmentMethod: dto.fulfillmentMethod,
            ...deliverySnapshot,
            subtotal,
            deliveryFee,
            items: {
              create: lineItems.map(({ item, unitPrice, lineTotal }) => ({
                variantId: item.variantId,
                productName: item.variant.product.name,
                sku: item.variant.sku,
                unit: item.variant.unit,
                weight: item.variant.weight,
                unitPrice,
                quantity: item.quantity,
                lineTotal,
              })),
            },
          },
          include: ORDER_INCLUDE,
        });

        // Sorted so two concurrent orders sharing products always lock
        // variants in the same order — avoids a classic cross-order deadlock.
        const sortedItems = [...cartItems].sort((a, b) => a.variantId.localeCompare(b.variantId));
        for (const item of sortedItems) {
          try {
            await this.inventoryService.reserveStockTx(tx, item.variantId, {
              quantity: item.quantity,
              orderId: order.id,
            });
          } catch (error) {
            if (error instanceof BadRequestException) {
              throw new BadRequestException(`${item.variant.product.name}: ${error.message}`);
            }
            throw error;
          }
        }

        await tx.cartItem.deleteMany({ where: { customerId } });

        return order;
      })
      .then((order) => this.withTotal(order));
  }

  async findMineAll(customerId: string) {
    const orders = await this.prisma.order.findMany({
      where: { customerId },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return orders.map((order) => this.withTotal(order));
  }

  async findMineOne(customerId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerId },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return this.withTotal(order);
  }

  async cancelOrder(customerId: string, orderId: string, dto: CancelOrderDto) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, customerId } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (!CUSTOMER_CANCELLABLE_STATUSES.includes(order.status)) {
      throw new BadRequestException(
        `This order can no longer be cancelled (status: ${order.status})`,
      );
    }

    return this.performCancellation(orderId, dto.reason ?? 'Cancelled by customer');
  }

  async findAllForStaff(query: QueryOrdersDto) {
    const orders = await this.prisma.order.findMany({
      where: query.status ? { status: query.status } : undefined,
      include: ORDER_INCLUDE_WITH_CUSTOMER,
      orderBy: { createdAt: 'desc' },
    });
    return orders.map((order) => this.withTotal(order));
  }

  async findOneForStaff(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE_WITH_CUSTOMER,
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return this.withTotal(order);
  }

  /**
   * Placeholder for the future payment-gateway webhook (Step 6) — for now
   * also usable as a manual staff action, since CASH orders never need it
   * but UPI orders currently have no other way to move past PENDING_PAYMENT.
   */
  async confirmPayment(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException(
        `Cannot confirm payment for an order with status ${order.status}`,
      );
    }
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CONFIRMED },
    });
    return this.withTotal(updated);
  }

  async updateStatus(orderId: string, dto: UpdateOrderStatusDto) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const allowed = ALLOWED_STATUS_TRANSITIONS[order.status];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(`Cannot move an order from ${order.status} to ${dto.status}`);
    }

    if (dto.status === OrderStatus.CANCELLED) {
      return this.performCancellation(orderId, 'Cancelled by staff');
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: dto.status },
    });
    return this.withTotal(updated);
  }

  /**
   * A UPI order abandoned mid-checkout would otherwise sit at
   * PENDING_PAYMENT forever — its stock reservation already lazily stops
   * counting once expired (see Inventory), but the order record itself
   * needs an explicit push. Manually triggered for now, same as
   * Inventory's own cleanup — no scheduler exists yet, but correctness
   * doesn't depend on this running promptly, only on it running eventually.
   */
  async expireAbandonedOrders() {
    const candidates = await this.prisma.order.findMany({
      where: { status: OrderStatus.PENDING_PAYMENT },
      include: { stockReservations: true },
    });

    let cancelledCount = 0;
    for (const order of candidates) {
      const stillHeld = order.stockReservations.some(
        (reservation) => reservation.status === 'ACTIVE' && reservation.expiresAt > new Date(),
      );
      if (!stillHeld) {
        await this.performCancellation(
          order.id,
          'Payment window expired — order automatically cancelled',
        );
        cancelledCount += 1;
      }
    }

    return { cancelledCount };
  }

  /** Lets the checkout screen preview the real fee/threshold before placing the order. */
  getDeliveryFeeInfo() {
    return {
      fee: Number(this.configService.get<string>('DELIVERY_FEE') ?? 0),
      freeThreshold: Number(this.configService.get<string>('FREE_DELIVERY_THRESHOLD') ?? 0),
    };
  }

  /** PICKUP is always free. DELIVERY is free above the threshold, otherwise a flat fee. */
  private calculateDeliveryFee(fulfillmentMethod: FulfillmentMethod, subtotal: number): number {
    if (fulfillmentMethod === FulfillmentMethod.PICKUP) {
      return 0;
    }
    const freeThreshold = Number(this.configService.get<string>('FREE_DELIVERY_THRESHOLD') ?? 0);
    if (subtotal >= freeThreshold) {
      return 0;
    }
    return Number(this.configService.get<string>('DELIVERY_FEE') ?? 0);
  }

  /** Releases every active reservation tied to this order, then marks it cancelled. */
  private async performCancellation(orderId: string, reason: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const activeReservations = await tx.stockReservation.findMany({
        where: { orderId, status: 'ACTIVE' },
      });
      for (const reservation of activeReservations) {
        await this.inventoryService.releaseReservationTx(tx, reservation.id, reason);
      }

      return tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason },
      });
    });
    return this.withTotal(updated);
  }

  /** subtotal and deliveryFee are both frozen at creation, so this can never drift. */
  private withTotal<T extends { subtotal: unknown; deliveryFee: unknown }>(order: T) {
    return { ...order, total: Number(order.subtotal) + Number(order.deliveryFee) };
  }
}
