/**
 * Offline conflict helpers for POS sync.
 * - Stock: real-time availability check before committing a sale.
 * - Cart: last-write-wins using client wall-clock vs server updatedAt.
 */

export type StockConflictLine = {
  productId: string;
  productName: string;
  requested: number;
  available: number;
};

/** True when the client snapshot is newer or equal → apply overwrite (LWW). */
export function shouldApplyClientCartWrite(
  clientUpdatedAtIso: string | undefined | null,
  serverUpdatedAt: Date | null | undefined,
): boolean {
  if (!clientUpdatedAtIso) {
    // Legacy clients without a timestamp: allow write (server recomputes money anyway).
    return true;
  }
  const clientMs = Date.parse(clientUpdatedAtIso);
  if (!Number.isFinite(clientMs)) {
    return true;
  }
  if (!serverUpdatedAt) {
    return true;
  }
  return clientMs >= serverUpdatedAt.getTime();
}

export function buildStockConflictMessage(conflicts: StockConflictLine[]): string {
  if (!conflicts.length) {
    return 'Insufficient stock';
  }
  const parts = conflicts.map(
    (c) => `${c.productName}: minta ${c.requested}, tersedia ${c.available}`,
  );
  return `Stok tidak cukup setelah offline: ${parts.join('; ')}`;
}
