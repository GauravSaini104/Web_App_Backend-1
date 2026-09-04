-- CreateEnum
CREATE TYPE "UnitOfMeasure" AS ENUM ('G', 'KG', 'ML', 'L', 'PCS');

-- AlterTable: convert existing free-text `unit` values (e.g. "g", "kg") to the
-- new enum without losing data. Existing values were stored lowercase, so we
-- upper-case them before casting rather than dropping/recreating the column.
ALTER TABLE "products" ADD COLUMN "unit_new" "UnitOfMeasure";
UPDATE "products" SET "unit_new" = UPPER("unit")::"UnitOfMeasure";
ALTER TABLE "products" ALTER COLUMN "unit_new" SET NOT NULL;
ALTER TABLE "products" DROP COLUMN "unit";
ALTER TABLE "products" RENAME COLUMN "unit_new" TO "unit";

-- Business rule: selling price can never exceed MRP. Enforced in application
-- code already (ProductsService); this is the database-level backstop so it
-- can't be bypassed by a script or future direct DB write.
ALTER TABLE "products" ADD CONSTRAINT "selling_price_not_above_mrp" CHECK ("sellingPrice" <= "mrp");

-- Weight must never be negative.
ALTER TABLE "products" ADD CONSTRAINT "weight_nonnegative" CHECK ("weight" >= 0);
