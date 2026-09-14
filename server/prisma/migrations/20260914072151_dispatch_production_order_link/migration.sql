-- AlterTable
ALTER TABLE "dispatches" ADD COLUMN "production_order_id" INTEGER;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
