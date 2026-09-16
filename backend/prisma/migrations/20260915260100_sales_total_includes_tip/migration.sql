-- Allow tipInCents in sales total integrity check
ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_total_matches";
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_total_matches"
  CHECK (
    "total_in_cents" = "subtotal_in_cents" + "tax_in_cents" - "discount_in_cents" + "tip_in_cents"
  );

ALTER TABLE "sales"
  DROP CONSTRAINT IF EXISTS "sales_tip_non_negative";
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_tip_non_negative" CHECK ("tip_in_cents" >= 0);
