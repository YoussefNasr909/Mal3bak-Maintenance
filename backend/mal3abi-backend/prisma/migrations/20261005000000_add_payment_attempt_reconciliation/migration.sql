-- Persist a merchant-controlled correlation key before any network call to Paymob. This closes
-- the crash window between Paymob accepting an intention/order and this app storing Paymob's IDs.
ALTER TABLE "Payment"
ADD COLUMN "merchantReference" TEXT,
ADD COLUMN "reconciliationAlertedAt" TIMESTAMP(3),
ADD COLUMN "reconciliationLastError" TEXT;

CREATE UNIQUE INDEX "Payment_merchantReference_key" ON "Payment"("merchantReference");
CREATE INDEX "Payment_merchantReference_idx" ON "Payment"("merchantReference");
