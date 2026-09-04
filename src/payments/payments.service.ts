import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { OrdersService } from '../orders/orders.service';

interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

interface RazorpayWebhookBody {
  event: string;
  payload?: {
    payment?: {
      entity?: {
        id: string;
        order_id: string;
        error_description?: string;
      };
    };
  };
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly ordersService: OrdersService,
  ) {}

  isConfigured(): boolean {
    return (
      this.configService.get<string>('PAYMENT_PROVIDER')?.trim() === 'razorpay' &&
      Boolean(this.configService.get<string>('RAZORPAY_KEY_ID')?.trim()) &&
      Boolean(this.configService.get<string>('RAZORPAY_KEY_SECRET')?.trim())
    );
  }

  /** Starts a payment attempt for a PENDING_PAYMENT UPI order. */
  async initiatePayment(customerId: string, orderId: string) {
    if (!this.isConfigured()) {
      throw new InternalServerErrorException('Payment gateway is not configured yet');
    }

    const order = await this.prisma.order.findFirst({ where: { id: orderId, customerId } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.paymentMethod !== PaymentMethod.UPI) {
      throw new BadRequestException('This order does not require online payment');
    }
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException(
        `Cannot start payment for an order with status ${order.status}`,
      );
    }

    const totalAmount = Number(
      (Number(order.subtotal) + Number(order.deliveryFee ?? 0)).toFixed(2),
    );

    let razorpayOrder: RazorpayOrder;
    try {
      razorpayOrder = await this.createRazorpayOrder(totalAmount, order.id);
    } catch (error) {
      this.logger.error(
        `Failed to create Razorpay order for ${order.id}: ${(error as Error).message}`,
      );
      throw new InternalServerErrorException(
        'Could not initiate payment right now — please try again shortly',
      );
    }

    const payment = await this.prisma.payment.create({
      data: {
        orderId: order.id,
        providerOrderId: razorpayOrder.id,
        amount: totalAmount,
        status: PaymentStatus.CREATED,
      },
    });

    return {
      paymentId: payment.id,
      providerOrderId: razorpayOrder.id,
      amount: totalAmount,
      currency: 'INR',
      // The customer-facing checkout widget needs the public key to open —
      // never the key secret, which never leaves the server.
      keyId: this.configService.get<string>('RAZORPAY_KEY_ID'),
    };
  }

  /**
   * The security-critical entry point: verifies Razorpay's signature on
   * the exact raw bytes it sent before trusting anything in the payload.
   * Without this, anyone could POST a fake "payment succeeded" event.
   */
  async handleWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    body: RazorpayWebhookBody,
  ) {
    if (!rawBody || !signature || !this.verifySignature(rawBody, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const paymentEntity = body.payload?.payment?.entity;
    if (!paymentEntity) {
      return { received: true };
    }

    const payment = await this.prisma.payment.findUnique({
      where: { providerOrderId: paymentEntity.order_id },
    });
    if (!payment) {
      this.logger.warn(`Webhook for unknown Razorpay order ${paymentEntity.order_id}`);
      return { received: true };
    }

    // Idempotency: Razorpay retries webhooks. A payment already resolved
    // (by an earlier delivery of this same event) is left untouched.
    if (payment.status !== PaymentStatus.CREATED) {
      return { received: true };
    }

    if (body.event === 'payment.captured') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.SUCCESS, providerPaymentId: paymentEntity.id },
      });
      try {
        await this.ordersService.confirmPayment(payment.orderId);
      } catch (error) {
        // The order was likely already cancelled (e.g. the abandoned-order
        // cleanup ran first) — money was captured for an order we no
        // longer intend to fulfill. Never silently swallow this.
        this.logger.error(
          `Payment captured for order ${payment.orderId} but the order could not be confirmed — needs manual reconciliation: ${(error as Error).message}`,
        );
      }
    } else if (body.event === 'payment.failed') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          failureReason: paymentEntity.error_description ?? 'Payment failed',
        },
      });
      // Order stays PENDING_PAYMENT — the customer can retry.
    }

    return { received: true };
  }

  private verifySignature(rawBody: Buffer, signature: string): boolean {
    const secret = this.configService.get<string>('RAZORPAY_WEBHOOK_SECRET') ?? '';
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

    const expectedBuffer = Buffer.from(expected, 'hex');
    const providedBuffer = Buffer.from(signature, 'hex');
    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }
    return timingSafeEqual(expectedBuffer, providedBuffer);
  }

  private async createRazorpayOrder(amountRupees: number, receipt: string): Promise<RazorpayOrder> {
    const keyId = this.configService.get<string>('RAZORPAY_KEY_ID')!.trim();
    const keySecret = this.configService.get<string>('RAZORPAY_KEY_SECRET')!.trim();
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: Math.round(amountRupees * 100), // Razorpay expects paise
        currency: 'INR',
        receipt,
      }),
    });

    const responseBody = (await response.json()) as RazorpayOrder & {
      error?: { description?: string };
    };
    if (!response.ok) {
      throw new Error(
        responseBody.error?.description ?? `Razorpay returned HTTP ${response.status}`,
      );
    }

    return responseBody;
  }
}
