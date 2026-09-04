-- CreateTable: one row per sellable pack size
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "mrp" DECIMAL(10,2) NOT NULL,
    "sellingPrice" DECIMAL(10,2) NOT NULL,
    "unit" "UnitOfMeasure" NOT NULL,
    "weight" DECIMAL(10,3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- Data migration: every existing product had exactly one pack size, so it
-- becomes exactly one variant carrying its old sku/price/unit/weight. No
-- data is lost — it just moves to the new table.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
INSERT INTO "product_variants"
  ("id", "productId", "sku", "mrp", "sellingPrice", "unit", "weight", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", "sku", "mrp", "sellingPrice", "unit", "weight", "isActive", "createdAt", now()
FROM "products";

-- Drop constraints/indexes that referenced the columns being moved off `products`
ALTER TABLE "products" DROP CONSTRAINT "selling_price_not_above_mrp";
ALTER TABLE "products" DROP CONSTRAINT "weight_nonnegative";
DROP INDEX "products_sku_key";
DROP INDEX "products_sellingPrice_idx";

-- AlterTable: remove the columns now that they live on product_variants
ALTER TABLE "products"
  DROP COLUMN "sku",
  DROP COLUMN "mrp",
  DROP COLUMN "sellingPrice",
  DROP COLUMN "unit",
  DROP COLUMN "weight";

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");
CREATE INDEX "product_variants_productId_idx" ON "product_variants"("productId");
CREATE INDEX "product_variants_isActive_idx" ON "product_variants"("isActive");
CREATE INDEX "product_variants_sellingPrice_idx" ON "product_variants"("sellingPrice");

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Re-create the price/weight business-rule constraints on the table that now owns those columns
ALTER TABLE "product_variants" ADD CONSTRAINT "selling_price_not_above_mrp" CHECK ("sellingPrice" <= "mrp");
ALTER TABLE "product_variants" ADD CONSTRAINT "weight_nonnegative" CHECK ("weight" >= 0);
