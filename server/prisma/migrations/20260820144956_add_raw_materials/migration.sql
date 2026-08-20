-- Catálogo de materia prima + stock + movimientos, para llevar inventario
-- de insumos de Extrusión (BAJA/ALTA/BIODEGRADABLE/etc.) con descuento
-- automático al cerrar una OP de Extrusión.

CREATE TYPE "RawMaterialMovementType" AS ENUM ('compra', 'consumo_produccion', 'ajuste');

CREATE TABLE "raw_materials" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "min_stock" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_materials_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "raw_materials_code_key" ON "raw_materials"("code");

CREATE TABLE "raw_material_stock" (
    "raw_material_id" INTEGER NOT NULL,
    "current_quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "raw_material_stock_pkey" PRIMARY KEY ("raw_material_id")
);
ALTER TABLE "raw_material_stock" ADD CONSTRAINT "raw_material_stock_raw_material_id_fkey"
  FOREIGN KEY ("raw_material_id") REFERENCES "raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "raw_material_movements" (
    "id" SERIAL NOT NULL,
    "raw_material_id" INTEGER NOT NULL,
    "movement_type" "RawMaterialMovementType" NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "reference_type" TEXT,
    "reference_id" INTEGER,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_material_movements_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "raw_material_movements" ADD CONSTRAINT "raw_material_movements_raw_material_id_fkey"
  FOREIGN KEY ("raw_material_id") REFERENCES "raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "raw_material_movements" ADD CONSTRAINT "raw_material_movements_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
