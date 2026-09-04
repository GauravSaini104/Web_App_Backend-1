import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InventoryTransactionType, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { handlePrismaError } from '../common/utils/prisma-error.util';
import { DEFAULT_LOW_STOCK_THRESHOLD, RESERVATION_HOLD_MINUTES } from './inventory.constants';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { WriteOffStockDto } from './dto/write-off-stock.dto';
import { ReturnStockDto } from './dto/return-stock.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateInventorySettingsDto } from './dto/update-inventory-settings.dto';

interface InventoryRow {
  id: string;
  quantityOnHand: number;
  isSellable: boolean;
}

/** Either the top-level Prisma client, or an in-progress transaction handed in by a caller. */
type DbClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Current state plus everything computed live: never trust a cached number for these. */
  async getInventory(variantId: string) {
    const inventory = await this.prisma.inventory.findUnique({ where: { variantId } });
    if (!inventory) {
      throw new NotFoundException('No inventory record for this product variant');
    }

    const reserved = await this.getActiveReservedQuantity(variantId);
    const available = inventory.quantityOnHand - reserved;
    const effectiveLowStockThreshold = inventory.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;

    return {
      ...inventory,
      reserved,
      available,
      effectiveLowStockThreshold,
      isOutOfStock: available <= 0,
      isLowStock: available > 0 && available <= effectiveLowStockThreshold,
    };
  }

  getTransactionHistory(variantId: string) {
    return this.prisma.inventoryTransaction.findMany({
      where: { variantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateSettings(variantId: string, dto: UpdateInventorySettingsDto) {
    try {
      return await this.prisma.inventory.update({
        where: { variantId },
        data: { lowStockThreshold: dto.lowStockThreshold, isSellable: dto.isSellable },
      });
    } catch (error) {
      handlePrismaError(error, 'Inventory');
    }
  }

  /** Standalone entry point: opens its own transaction, then delegates to the composable version below. */
  reserveStock(variantId: string, dto: CreateReservationDto) {
    return this.prisma.$transaction((tx) => this.reserveStockTx(tx, variantId, dto));
  }

  /**
   * The critical, concurrency-safe operation: creates a stock hold only if
   * there is genuinely enough available stock, locking this variant's
   * inventory row for the entire check. Composable — pass in an existing
   * transaction (e.g. Orders reserving several variants atomically in one
   * multi-item checkout) or call `reserveStock()` for a one-off standalone
   * reservation, which just wraps this in its own transaction.
   */
  async reserveStockTx(tx: Prisma.TransactionClient, variantId: string, dto: CreateReservationDto) {
    const rows = await tx.$queryRaw<InventoryRow[]>`
      SELECT "id", "quantityOnHand", "isSellable" FROM "inventory" WHERE "variantId" = ${variantId} FOR UPDATE
    `;
    const inventory = rows[0];
    if (!inventory) {
      throw new NotFoundException('No inventory record for this product variant');
    }
    if (!inventory.isSellable) {
      throw new BadRequestException('This item is not currently available for sale');
    }

    const currentlyReserved = await this.getActiveReservedQuantity(variantId, tx);
    const available = inventory.quantityOnHand - currentlyReserved;

    if (available < dto.quantity) {
      throw new BadRequestException(`Only ${Math.max(available, 0)} unit(s) available`);
    }

    const expiresAt = new Date(Date.now() + RESERVATION_HOLD_MINUTES * 60 * 1000);
    const reservation = await tx.stockReservation.create({
      data: { variantId, orderId: dto.orderId, quantity: dto.quantity, expiresAt },
    });

    await tx.inventoryTransaction.create({
      data: {
        variantId,
        reservationId: reservation.id,
        orderId: dto.orderId,
        type: InventoryTransactionType.RESERVE,
        reservedDelta: dto.quantity,
        balanceOnHandAfter: inventory.quantityOnHand,
        balanceReservedAfter: currentlyReserved + dto.quantity,
        reason: dto.orderId ? `Reserved for order ${dto.orderId}` : 'Manual reservation',
        performedBy: 'SYSTEM',
      },
    });

    return reservation;
  }

  /** Cancelled before payment, payment failed, or the customer backed out — frees the hold. */
  releaseReservation(reservationId: string, reason?: string) {
    return this.prisma.$transaction((tx) => this.releaseReservationTx(tx, reservationId, reason));
  }

  /** Composable version — see reserveStockTx for why this split exists. */
  async releaseReservationTx(tx: Prisma.TransactionClient, reservationId: string, reason?: string) {
    const updateResult = await tx.stockReservation.updateMany({
      where: { id: reservationId, status: 'ACTIVE' },
      data: { status: 'RELEASED' },
    });
    const reservation = await this.assertReservationTransition(
      tx,
      reservationId,
      updateResult.count,
    );

    const [inventory, stillReserved] = await Promise.all([
      tx.inventory.findUniqueOrThrow({ where: { variantId: reservation.variantId } }),
      this.getActiveReservedQuantity(reservation.variantId, tx),
    ]);

    await tx.inventoryTransaction.create({
      data: {
        variantId: reservation.variantId,
        reservationId,
        orderId: reservation.orderId,
        type: InventoryTransactionType.RELEASE,
        reservedDelta: -reservation.quantity,
        balanceOnHandAfter: inventory.quantityOnHand,
        balanceReservedAfter: stillReserved,
        reason:
          reason ??
          (reservation.orderId
            ? `Order ${reservation.orderId} cancelled or payment failed`
            : 'Manual release'),
        performedBy: 'SYSTEM',
      },
    });

    return reservation;
  }

  /**
   * The hold is fulfilled — physically dispatched. This is where stock
   * actually leaves onHand, deliberately separate from payment success
   * (see the Step 2 spec: dispatch-based deduction, not payment-based).
   */
  async consumeReservation(reservationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.stockReservation.findUnique({ where: { id: reservationId } });
      if (!existing) {
        throw new NotFoundException('Reservation not found');
      }
      if (existing.status === 'ACTIVE' && existing.expiresAt <= new Date()) {
        throw new BadRequestException('This reservation has expired and can no longer be consumed');
      }

      const updateResult = await tx.stockReservation.updateMany({
        where: { id: reservationId, status: 'ACTIVE' },
        data: { status: 'CONSUMED' },
      });
      const reservation = await this.assertReservationTransition(
        tx,
        reservationId,
        updateResult.count,
      );

      const rows = await tx.$queryRaw<{ quantityOnHand: number }[]>`
        SELECT "quantityOnHand" FROM "inventory" WHERE "variantId" = ${reservation.variantId} FOR UPDATE
      `;
      const newOnHand = rows[0].quantityOnHand - reservation.quantity;
      await tx.inventory.update({
        where: { variantId: reservation.variantId },
        data: { quantityOnHand: newOnHand },
      });

      const stillReserved = await this.getActiveReservedQuantity(reservation.variantId, tx);

      await tx.inventoryTransaction.create({
        data: {
          variantId: reservation.variantId,
          reservationId,
          orderId: reservation.orderId,
          type: InventoryTransactionType.SALE,
          onHandDelta: -reservation.quantity,
          reservedDelta: -reservation.quantity,
          balanceOnHandAfter: newOnHand,
          balanceReservedAfter: stillReserved,
          reason: reservation.orderId
            ? `Dispatched for order ${reservation.orderId}`
            : 'Manual consumption',
          performedBy: 'SYSTEM',
        },
      });

      return reservation;
    });
  }

  receiveStock(variantId: string, dto: ReceiveStockDto) {
    return this.mutateOnHand(
      variantId,
      dto.quantity,
      InventoryTransactionType.RECEIVE,
      dto.reason,
      dto.performedBy,
    );
  }

  adjustStock(variantId: string, dto: AdjustStockDto) {
    return this.mutateOnHand(
      variantId,
      dto.quantityDelta,
      InventoryTransactionType.ADJUSTMENT,
      dto.reason,
      dto.performedBy,
    );
  }

  writeOffStock(variantId: string, dto: WriteOffStockDto) {
    return this.mutateOnHand(
      variantId,
      -dto.quantity,
      InventoryTransactionType.DAMAGE,
      dto.reason,
      dto.performedBy,
    );
  }

  returnStock(variantId: string, dto: ReturnStockDto) {
    return this.mutateOnHand(
      variantId,
      dto.quantity,
      InventoryTransactionType.RETURN,
      dto.reason,
      dto.performedBy,
      dto.orderId,
    );
  }

  /**
   * Finds reservations sitting at ACTIVE past their expiry and formally
   * flips them to EXPIRED, writing the audit entry. Manually triggered for
   * now — there's no scheduler yet — but correctness never depended on
   * this running: getActiveReservedQuantity() already excludes anything
   * past expiresAt regardless of its stored status.
   */
  async expireStaleReservations() {
    const stale = await this.prisma.stockReservation.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: new Date() } },
    });

    let expiredCount = 0;
    for (const reservation of stale) {
      await this.prisma.$transaction(async (tx) => {
        const updateResult = await tx.stockReservation.updateMany({
          where: { id: reservation.id, status: 'ACTIVE' },
          data: { status: 'EXPIRED' },
        });
        if (updateResult.count === 0) {
          return;
        }

        const [inventory, stillReserved] = await Promise.all([
          tx.inventory.findUniqueOrThrow({ where: { variantId: reservation.variantId } }),
          this.getActiveReservedQuantity(reservation.variantId, tx),
        ]);

        await tx.inventoryTransaction.create({
          data: {
            variantId: reservation.variantId,
            reservationId: reservation.id,
            orderId: reservation.orderId,
            type: InventoryTransactionType.EXPIRED,
            reservedDelta: -reservation.quantity,
            balanceOnHandAfter: inventory.quantityOnHand,
            balanceReservedAfter: stillReserved,
            reason: 'Reservation hold expired without payment/dispatch',
            performedBy: 'SYSTEM (cleanup)',
          },
        });
      });
      expiredCount += 1;
    }

    return { expiredCount };
  }

  private async getActiveReservedQuantity(variantId: string, client: DbClient = this.prisma) {
    const result = await client.stockReservation.aggregate({
      _sum: { quantity: true },
      where: { variantId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
    });
    return result._sum.quantity ?? 0;
  }

  /** Shared onHand-mutating path for RECEIVE/ADJUSTMENT/DAMAGE/RETURN — all "lock, change, log" in one shape. */
  private async mutateOnHand(
    variantId: string,
    delta: number,
    type: InventoryTransactionType,
    reason: string,
    performedBy: string,
    orderId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ quantityOnHand: number }[]>`
        SELECT "quantityOnHand" FROM "inventory" WHERE "variantId" = ${variantId} FOR UPDATE
      `;
      if (rows.length === 0) {
        throw new NotFoundException('No inventory record for this product variant');
      }

      const newOnHand = rows[0].quantityOnHand + delta;
      if (newOnHand < 0) {
        throw new BadRequestException(
          `Cannot remove ${Math.abs(delta)} unit(s) — only ${rows[0].quantityOnHand} on hand`,
        );
      }

      await tx.inventory.update({ where: { variantId }, data: { quantityOnHand: newOnHand } });
      const reserved = await this.getActiveReservedQuantity(variantId, tx);

      return tx.inventoryTransaction.create({
        data: {
          variantId,
          orderId,
          type,
          onHandDelta: delta,
          balanceOnHandAfter: newOnHand,
          balanceReservedAfter: reserved,
          reason,
          performedBy,
        },
      });
    });
  }

  /** Turns a 0-row conditional update into the right 404/400, or returns the now-updated reservation. */
  private async assertReservationTransition(
    tx: Prisma.TransactionClient,
    reservationId: string,
    updatedCount: number,
  ) {
    if (updatedCount === 0) {
      const existing = await tx.stockReservation.findUnique({ where: { id: reservationId } });
      if (!existing) {
        throw new NotFoundException('Reservation not found');
      }
      throw new BadRequestException(`This reservation is already ${existing.status.toLowerCase()}`);
    }
    return tx.stockReservation.findUniqueOrThrow({ where: { id: reservationId } });
  }
}
