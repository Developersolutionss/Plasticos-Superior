-- Rediseño de OP: una orden por proceso (formatos en papel del cliente).
-- Se reemplaza el registro por estaciones (production_stage_logs) por el
-- registro acumulativo de rollos (production_rolls); las OP ganan estación
-- propia, cliente, specs de plantilla y cadena de derivación.

-- AlterTable: production_orders
ALTER TABLE "production_orders" ADD COLUMN "station" "ProductionStation" NOT NULL DEFAULT 'extrusion';
ALTER TABLE "production_orders" ADD COLUMN "client_id" INTEGER;
ALTER TABLE "production_orders" ADD COLUMN "specs" JSONB;
ALTER TABLE "production_orders" ADD COLUMN "parent_order_id" INTEGER;

ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_parent_order_id_fkey"
  FOREIGN KEY ("parent_order_id") REFERENCES "production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropTable: production_stage_logs (solo tenía datos demo; el modelo nuevo
-- registra rollos por OP en vez de pasos por estación)
DROP TABLE "production_stage_logs";

-- CreateTable: production_rolls
CREATE TABLE "production_rolls" (
    "id" SERIAL NOT NULL,
    "production_order_id" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shift" TEXT,
    "operator_name" TEXT NOT NULL,
    "machine" TEXT,
    "label" TEXT,
    "weight_kg" DECIMAL(12,2) NOT NULL,
    "waste_kg" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "details" JSONB,
    "notes" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_rolls_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "production_rolls" ADD CONSTRAINT "production_rolls_production_order_id_fkey"
  FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_rolls" ADD CONSTRAINT "production_rolls_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: production_order_attachments
CREATE TABLE "production_order_attachments" (
    "id" SERIAL NOT NULL,
    "production_order_id" INTEGER NOT NULL,
    "stored_name" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_order_attachments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "production_order_attachments" ADD CONSTRAINT "production_order_attachments_production_order_id_fkey"
  FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_order_attachments" ADD CONSTRAINT "production_order_attachments_uploaded_by_fkey"
  FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
