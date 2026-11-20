-- CreateTable
CREATE TABLE "User" (
    "wallet" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("wallet")
);

-- CreateTable
CREATE TABLE "AuthChallenge" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "tokenHash" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceVersion" (
    "serviceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "price" DECIMAL(78,0) NOT NULL,
    "payout" TEXT NOT NULL,
    "signer" TEXT NOT NULL,
    "container" TEXT NOT NULL,
    "metadataHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,

    CONSTRAINT "PriceVersion_pkey" PRIMARY KEY ("serviceId","version")
);

-- CreateTable
CREATE TABLE "SpendingSession" (
    "id" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "signer" TEXT NOT NULL,
    "budget" DECIMAL(78,0) NOT NULL,
    "softLimit" DECIMAL(78,0) NOT NULL,
    "maxCharge" DECIMAL(78,0) NOT NULL,
    "expiresAt" BIGINT NOT NULL,
    "refundAfter" BIGINT NOT NULL,
    "status" INTEGER NOT NULL,
    "indexedBlock" BIGINT NOT NULL,

    CONSTRAINT "SpendingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "APIRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "priceVersion" INTEGER NOT NULL,
    "nonce" DECIMAL(78,0) NOT NULL,
    "requestHash" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "wireRequest" JSONB NOT NULL,
    "authorization" JSONB NOT NULL,
    "chargeSignature" TEXT NOT NULL,
    "customerOverride" JSONB,
    "amount" DECIMAL(78,0) NOT NULL,
    "reservationActive" BOOLEAN NOT NULL DEFAULT true,
    "requestStatus" TEXT NOT NULL DEFAULT 'authorized',
    "paymentStatus" TEXT NOT NULL DEFAULT 'unsubmitted',
    "chargeAuthorized" BOOLEAN NOT NULL DEFAULT false,
    "result" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "APIRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageReceipt" (
    "requestId" TEXT NOT NULL,
    "envelope" JSONB NOT NULL,
    "digest" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "signer" TEXT NOT NULL,
    "reportedUsage" JSONB,
    "aiReceipt" JSONB,
    "providerVerified" BOOLEAN NOT NULL,
    "delivery" TEXT NOT NULL DEFAULT 'reported',
    "customerAcceptance" TEXT NOT NULL DEFAULT 'not_requested',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageReceipt_pkey" PRIMARY KEY ("requestId")
);

-- CreateTable
CREATE TABLE "ProviderExecution" (
    "id" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "envelope" JSONB,
    "aiReceipt" JSONB,
    "upstreamResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementAttempt" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "transactionHash" TEXT,
    "rawTransaction" TEXT,
    "nonce" BIGINT,
    "maximumGasCost" DECIMAL(78,0),
    "actualGasCost" DECIMAL(78,0),
    "evidence" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "requestId" TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "policyInputs" INTEGER NOT NULL,
    "confirmationStatus" TEXT NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("requestId")
);

-- CreateTable
CREATE TABLE "ChainEvent" (
    "chainId" INTEGER NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "contract" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,

    CONSTRAINT "ChainEvent_pkey" PRIMARY KEY ("chainId","transactionHash","logIndex")
);

-- CreateTable
CREATE TABLE "IndexerCursor" (
    "id" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ready',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "APIKey" (
    "id" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "scopes" TEXT[],
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "APIKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "APIRequest_customer_createdAt_idx" ON "APIRequest"("customer", "createdAt");

-- CreateIndex
CREATE INDEX "APIRequest_sessionId_reservationActive_idx" ON "APIRequest"("sessionId", "reservationActive");

-- CreateIndex
CREATE UNIQUE INDEX "APIRequest_sessionId_nonce_key" ON "APIRequest"("sessionId", "nonce");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementAttempt_transactionHash_key" ON "SettlementAttempt"("transactionHash");

-- CreateIndex
CREATE INDEX "SettlementAttempt_requestId_idx" ON "SettlementAttempt"("requestId");

-- CreateIndex
CREATE INDEX "ChainEvent_blockNumber_idx" ON "ChainEvent"("blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "APIKey_keyHash_key" ON "APIKey"("keyHash");
