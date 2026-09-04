import { OrderStatus } from '@prisma/client';
import { IsIn } from 'class-validator';

// PENDING_PAYMENT and CONFIRMED are not reachable through this generic
// endpoint — CONFIRMED has its own dedicated confirm-payment action (the
// future payment-gateway webhook's entry point), and PENDING_PAYMENT only
// ever happens at order creation.
const STAFF_SETTABLE_STATUSES = [
  OrderStatus.PACKED,
  OrderStatus.READY,
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
] as const;

export class UpdateOrderStatusDto {
  @IsIn(STAFF_SETTABLE_STATUSES, {
    message: `status must be one of: ${STAFF_SETTABLE_STATUSES.join(', ')}`,
  })
  status!: OrderStatus;
}
