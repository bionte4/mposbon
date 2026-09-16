-- Static QRIS merchant payload (EMVCo MPM) per store for checkout QR display.
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "qris_payload" TEXT;
