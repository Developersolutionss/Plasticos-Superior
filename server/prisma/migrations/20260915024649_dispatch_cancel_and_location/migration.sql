-- AlterEnum
ALTER TYPE "DispatchStatus" ADD VALUE 'cancelada';

-- AlterTable
ALTER TABLE "dispatches" ADD COLUMN "cancelled_at" TIMESTAMP(3),
ADD COLUMN "cancelled_by" INTEGER;

-- AlterTable
ALTER TABLE "dispatch_items" ADD COLUMN "location_id" INTEGER;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_items" ADD CONSTRAINT "dispatch_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
