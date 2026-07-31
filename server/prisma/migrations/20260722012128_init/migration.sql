-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('produccion', 'despacho', 'admin');

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('bultos', 'rollos_prec_lam', 'rollos_fuelle', 'mangueta', 'tiras', 'control_impresion');

-- CreateEnum
CREATE TYPE "ProductUnit" AS ENUM ('kg', 'unidad');

-- CreateEnum
CREATE TYPE "ProductionStatus" AS ENUM ('pendiente', 'en_transito', 'recibido', 'rechazado');

-- CreateEnum
CREATE TYPE "ProductionSource" AS ENUM ('manual', 'excel_import', 'whatsapp_bot');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('entrada_produccion', 'salida_despacho', 'ajuste', 'devolucion');

-- CreateEnum
CREATE TYPE "ReferenceType" AS ENUM ('production_entry', 'dispatch_item', 'manual_adjustment');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('pendiente', 'en_proceso', 'despachado');

-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('manual_upload', 'whatsapp_bot');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "measure" TEXT,
    "unit" "ProductUnit" NOT NULL,
    "min_stock" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "contact_info" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_entries" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "label_code" TEXT,
    "operator_name" TEXT NOT NULL,
    "client_id" INTEGER,
    "measure" TEXT,
    "kilos" DECIMAL(12,2) NOT NULL,
    "driver_name" TEXT,
    "status" "ProductionStatus" NOT NULL DEFAULT 'pendiente',
    "source" "ProductionSource" NOT NULL DEFAULT 'manual',
    "observations" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "movement_type" "MovementType" NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "reference_type" "ReferenceType" NOT NULL,
    "reference_id" INTEGER,
    "production_entry_id" INTEGER,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_stock" (
    "product_id" INTEGER NOT NULL,
    "current_quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_stock_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "dispatches" (
    "id" SERIAL NOT NULL,
    "client_id" INTEGER NOT NULL,
    "status" "DispatchStatus" NOT NULL DEFAULT 'pendiente',
    "requested_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_date" TIMESTAMP(3),
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_items" (
    "id" SERIAL NOT NULL,
    "dispatch_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity_requested" DECIMAL(12,2) NOT NULL,
    "quantity_dispatched" DECIMAL(12,2),
    "label_code" TEXT,
    "notes" TEXT,

    CONSTRAINT "dispatch_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_logs" (
    "id" SERIAL NOT NULL,
    "filename" TEXT NOT NULL,
    "source" "ImportSource" NOT NULL,
    "rows_processed" INTEGER NOT NULL DEFAULT 0,
    "rows_failed" INTEGER NOT NULL DEFAULT 0,
    "uploaded_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- AddForeignKey
ALTER TABLE "production_entries" ADD CONSTRAINT "production_entries_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entries" ADD CONSTRAINT "production_entries_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entries" ADD CONSTRAINT "production_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_production_entry_id_fkey" FOREIGN KEY ("production_entry_id") REFERENCES "production_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_items" ADD CONSTRAINT "dispatch_items_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_items" ADD CONSTRAINT "dispatch_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_logs" ADD CONSTRAINT "import_logs_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
