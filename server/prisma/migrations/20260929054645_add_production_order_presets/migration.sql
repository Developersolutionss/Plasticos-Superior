-- DropIndex
DROP INDEX "production_rolls_source_roll_id_idx";

-- CreateTable
CREATE TABLE "production_order_presets" (
    "id" SERIAL NOT NULL,
    "client_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "station" TEXT NOT NULL,
    "measure" TEXT,
    "quantity_planned" DECIMAL(12,2),
    "specs" JSONB,
    "notes" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_order_presets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_order_presets_client_id_product_id_station_key" ON "production_order_presets"("client_id", "product_id", "station");

-- AddForeignKey
ALTER TABLE "production_order_presets" ADD CONSTRAINT "production_order_presets_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_presets" ADD CONSTRAINT "production_order_presets_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_presets" ADD CONSTRAINT "production_order_presets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
