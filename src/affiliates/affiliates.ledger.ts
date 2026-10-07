import { AffiliateEarningStatus, AffiliateEarningType, AffiliatePayoutStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';

export interface LedgerEarningRow {
  amount: Prisma.Decimal | number | string;
  type: AffiliateEarningType;
  status: AffiliateEarningStatus;
  reversesEarningId?: string | null;
}

export interface LedgerPayoutRow {
  amount: Prisma.Decimal | number | string;
  status: AffiliatePayoutStatus;
}

export interface AffiliateBalances {
  availableBalance: number;
  pendingBalance: number;
  lifetimeEarned: number;
  lifetimeAdjustments: number;
  lifetimePaid: number;
}

export interface ReconciliationResult {
  lhs: number;
  rhs: number;
  delta: number;
  isBalanced: boolean;
}

function toNumber(val: Prisma.Decimal | number | string | null | undefined): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  return Number(val.toString());
}

/**
 * Pure calculation of balances derived from append-only ledger rows.
 */
export function calculateBalances(
  earnings: LedgerEarningRow[],
  payouts: LedgerPayoutRow[],
): AffiliateBalances {
  let availableBalance = 0;
  let pendingBalance = 0;
  let lifetimeEarned = 0;
  let lifetimeAdjustments = 0;
  let lifetimePaid = 0;

  for (const e of earnings) {
    const amt = toNumber(e.amount);
    if (e.status === AffiliateEarningStatus.AVAILABLE) {
      availableBalance += amt;
    } else if (e.status === AffiliateEarningStatus.PENDING) {
      pendingBalance += amt;
    }

    if (e.type === AffiliateEarningType.COMMISSION) {
      lifetimeEarned += amt;
    } else if (e.type === AffiliateEarningType.ADJUSTMENT && !e.reversesEarningId) {
      lifetimeAdjustments += amt;
    }
  }

  for (const p of payouts) {
    if (p.status === AffiliatePayoutStatus.PAID) {
      lifetimePaid += toNumber(p.amount);
    }
  }

  // Round to 2 decimal places to avoid floating point anomalies
  return {
    availableBalance: Math.round(availableBalance * 100) / 100,
    pendingBalance: Math.round(pendingBalance * 100) / 100,
    lifetimeEarned: Math.round(lifetimeEarned * 100) / 100,
    lifetimeAdjustments: Math.round(lifetimeAdjustments * 100) / 100,
    lifetimePaid: Math.round(lifetimePaid * 100) / 100,
  };
}

/**
 * Reconciles the affiliate system invariant:
 * availableBalance + pendingBalance + lifetimePaid == lifetimeEarned + lifetimeAdjustments
 */
export function checkReconciliation(balances: AffiliateBalances): ReconciliationResult {
  const lhs = Math.round((balances.availableBalance + balances.pendingBalance + balances.lifetimePaid) * 100) / 100;
  const rhs = Math.round((balances.lifetimeEarned + balances.lifetimeAdjustments) * 100) / 100;
  const delta = Math.round((lhs - rhs) * 100) / 100;

  return {
    lhs,
    rhs,
    delta,
    isBalanced: Math.abs(delta) < 0.005,
  };
}
