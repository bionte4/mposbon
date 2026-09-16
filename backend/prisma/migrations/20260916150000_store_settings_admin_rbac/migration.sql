-- Store identity / receipt settings beyond QRIS
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta';
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "receipt_header" TEXT;
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "receipt_footer" TEXT;
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;
