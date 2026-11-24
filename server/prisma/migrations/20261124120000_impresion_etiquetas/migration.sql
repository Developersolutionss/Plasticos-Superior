-- Impresión de etiquetas desde los celulares (pedido del cliente 2026-11-24):
-- impresoras de planta y cola de trabajos que recoge el puente de impresión.
-- Solo crea tablas nuevas: no toca datos existentes.
CREATE TYPE "PrintJobStatus" AS ENUM ('pendiente', 'enviado', 'impreso', 'error');

CREATE TABLE "label_printers" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "label_width_mm" INTEGER NOT NULL,
    "label_height_mm" INTEGER NOT NULL,
    "dpi" INTEGER NOT NULL DEFAULT 203,
    "stations" "ProductionStation"[],
    "agent_token_hash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMP(3),
    "agent_info" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "label_printers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "label_printers_agent_token_hash_key" ON "label_printers"("agent_token_hash");

CREATE TABLE "print_jobs" (
    "id" SERIAL NOT NULL,
    "printer_id" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "zpl" TEXT NOT NULL DEFAULT '',
    "status" "PrintJobStatus" NOT NULL DEFAULT 'pendiente',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_by" INTEGER,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    CONSTRAINT "print_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "print_jobs_printer_id_status_idx" ON "print_jobs"("printer_id", "status");
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_printer_id_fkey" FOREIGN KEY ("printer_id") REFERENCES "label_printers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
