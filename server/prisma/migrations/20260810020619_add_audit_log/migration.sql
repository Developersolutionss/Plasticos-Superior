-- Modulo de Auditoria forense: registro generico de create/update/delete
-- sobre tablas criticas (Client, Dispatch, ProductionEntry,
-- InventoryMovement), con estado antes/despues e IP/user-agent. Lo escribe
-- automaticamente la extension de Prisma en server/src/prisma.ts, no se
-- crea a mano desde ningun router.
CREATE TYPE "AuditAction" AS ENUM ('create', 'update', 'delete');

CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "table_name" TEXT NOT NULL,
    "record_id" INTEGER,
    "action" "AuditAction" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "user_id" INTEGER,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_table_name_record_id_idx" ON "audit_logs"("table_name", "record_id");

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
