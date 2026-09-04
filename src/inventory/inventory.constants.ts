/**
 * Used when a variant has no `lowStockThreshold` of its own set — a plain
 * config constant rather than a settings table, since this is an
 * alerting/reporting preference, not a safety mechanism.
 */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

/** How long a stock reservation holds units before it's eligible to expire. */
export const RESERVATION_HOLD_MINUTES = 15;
