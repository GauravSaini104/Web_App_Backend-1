-- CreateEnum
CREATE TYPE "AffiliateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AffiliateEarningType" AS ENUM ('COMMISSION', 'ADJUSTMENT', 'PAYOUT');

-- CreateEnum
CREATE TYPE "AffiliateEarningStatus" AS ENUM ('PENDING', 'AVAILABLE');

-- CreateEnum
CREATE TYPE "AffiliatePayoutStatus" AS ENUM ('REQUESTED', 'PAID', 'REJECTED');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "referralCodeUsed" TEXT,
ADD COLUMN     "referredAt" TIMESTAMP(3),
ADD COLUMN     "referredByAffiliateId" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "affiliateId" TEXT,
ADD COLUMN     "commissionRateApplied" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "affiliate_profiles" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "AffiliateStatus" NOT NULL DEFAULT 'PENDING',
    "referralCode" TEXT NOT NULL,
    "upiId" TEXT,
    "upiName" TEXT,
    "primaryChannel" TEXT NOT NULL,
    "channelUrl" TEXT,
    "audienceSize" TEXT,
    "motivation" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "rejectionReason" TEXT,
    "staffNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_earnings" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "type" "AffiliateEarningType" NOT NULL,
    "status" "AffiliateEarningStatus" NOT NULL DEFAULT 'AVAILABLE',
    "orderId" TEXT,
    "baseAmount" DECIMAL(10,2),
    "rateApplied" DECIMAL(5,2),
    "reversesEarningId" TEXT,
    "description" TEXT,
    "createdById" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_payouts" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "upiId" TEXT NOT NULL,
    "status" "AffiliatePayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processedById" TEXT,
    "transactionRef" TEXT,
    "notes" TEXT,
    "rejectionReason" TEXT,

    CONSTRAINT "affiliate_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "commissionRate" DECIMAL(5,2) NOT NULL DEFAULT 5.00,
    "minPayoutAmount" DECIMAL(10,2) NOT NULL DEFAULT 500.00,
    "holdDays" INTEGER NOT NULL DEFAULT 0,
    "isProgrammeOpen" BOOLEAN NOT NULL DEFAULT true,
    "termsVersion" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_profiles_customerId_key" ON "affiliate_profiles"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_profiles_referralCode_key" ON "affiliate_profiles"("referralCode");

-- CreateIndex
CREATE INDEX "affiliate_profiles_status_idx" ON "affiliate_profiles"("status");

-- CreateIndex
CREATE INDEX "affiliate_profiles_createdAt_idx" ON "affiliate_profiles"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_earnings_reversesEarningId_key" ON "affiliate_earnings"("reversesEarningId");

-- CreateIndex
CREATE INDEX "affiliate_earnings_affiliateId_status_idx" ON "affiliate_earnings"("affiliateId", "status");

-- CreateIndex
CREATE INDEX "affiliate_earnings_affiliateId_type_idx" ON "affiliate_earnings"("affiliateId", "type");

-- CreateIndex
CREATE INDEX "affiliate_earnings_orderId_idx" ON "affiliate_earnings"("orderId");

-- CreateIndex
CREATE INDEX "affiliate_payouts_status_requestedAt_idx" ON "affiliate_payouts"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "affiliate_payouts_affiliateId_idx" ON "affiliate_payouts"("affiliateId");

-- CreateIndex
CREATE INDEX "customers_referredByAffiliateId_idx" ON "customers"("referredByAffiliateId");

-- CreateIndex
CREATE INDEX "orders_affiliateId_idx" ON "orders"("affiliateId");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_referredByAffiliateId_fkey" FOREIGN KEY ("referredByAffiliateId") REFERENCES "affiliate_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "affiliate_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_profiles" ADD CONSTRAINT "affiliate_profiles_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_profiles" ADD CONSTRAINT "affiliate_profiles_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_earnings" ADD CONSTRAINT "affiliate_earnings_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "affiliate_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_earnings" ADD CONSTRAINT "affiliate_earnings_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_earnings" ADD CONSTRAINT "affiliate_earnings_reversesEarningId_fkey" FOREIGN KEY ("reversesEarningId") REFERENCES "affiliate_earnings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_earnings" ADD CONSTRAINT "affiliate_earnings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_payouts" ADD CONSTRAINT "affiliate_payouts_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "affiliate_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_payouts" ADD CONSTRAINT "affiliate_payouts_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
