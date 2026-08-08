-- CreateEnum
CREATE TYPE "ProductionOrderStatus" AS ENUM ('pendiente', 'en_proceso', 'detenida', 'finalizada', 'cancelada');

-- CreateEnum
CREATE TYPE "ProductionStation" AS ENUM ('extrusion', 'impresion', 'sellado', 'precorte');

-- CreateTable
CREATE TABLE "production_orders" (
    "id" SERIAL NOT NULL,
    "order_number" TEXT NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity_planned" DECIMAL(12,2) NOT NULL,
    "measure" TEXT,
    "status" "ProductionOrderStatus" NOT NULL DEFAULT 'pendiente',
    "notes" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_stage_logs" (
    "id" SERIAL NOT NULL,
    "production_order_id" INTEGER NOT NULL,
    "station" "ProductionStation" NOT NULL,
    "machine" TEXT NOT NULL,
    "operator_name" TEXT NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3),
    "kilos_produced" DECIMAL(12,2) NOT NULL,
    "merma_kg" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "downtime_minutes" INTEGER NOT NULL DEFAULT 0,
    "downtime_reason" TEXT,
    "details" JSONB,
    "notes" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_stage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_order_number_key" ON "production_orders"("order_number");

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stage_logs" ADD CONSTRAINT "production_stage_logs_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stage_logs" ADD CONSTRAINT "production_stage_logs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
