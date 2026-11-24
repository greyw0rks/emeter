-- Historical rows retain their original DEMO token and immutable vault.
ALTER TABLE "SpendingSession"
  ADD COLUMN "vault" TEXT NOT NULL DEFAULT '0x12412460847a865b29406fd8cd37df91dd881b50',
  ADD COLUMN "token" TEXT NOT NULL DEFAULT '0x66d16469e07217e53618887b492b14ea732b5a11';
ALTER TABLE "APIRequest"
  ADD COLUMN "vault" TEXT NOT NULL DEFAULT '0x12412460847a865b29406fd8cd37df91dd881b50',
  ADD COLUMN "token" TEXT NOT NULL DEFAULT '0x66d16469e07217e53618887b492b14ea732b5a11';
CREATE INDEX "APIRequest_vault_customer_createdAt_idx" ON "APIRequest" ("vault", "customer", "createdAt");
CREATE INDEX "SpendingSession_vault_customer_idx" ON "SpendingSession" ("vault", "customer");
