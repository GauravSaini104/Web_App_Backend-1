-- AlterTable: add deliveryFee, defaulting existing rows to 0 (they predate this feature)
ALTER TABLE "orders" ADD COLUMN "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 0;
