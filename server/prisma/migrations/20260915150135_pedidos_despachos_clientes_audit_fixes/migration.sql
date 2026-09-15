-- AlterTable
ALTER TABLE "dispatches" ADD COLUMN "notified_at" TIMESTAMP(3),
ADD COLUMN "notify_error" TEXT;

-- AlterTable
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_cotizacion_id_key" UNIQUE ("cotizacion_id");
