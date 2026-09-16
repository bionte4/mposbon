-- Audit action for per-store stock count / price override adjustments.
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'STOCK_ADJUST';
