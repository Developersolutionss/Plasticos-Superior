-- Modulo Calidad: la OP pasa por un estado intermedio "pendiente_calidad"
-- despues del paso de precorte, hasta que alguien del rol calidad la
-- aprueba (recien ahi se genera la entrada de inventario) o la rechaza
-- (la OP queda "detenida" para que Produccion decida que hacer).
ALTER TYPE "ProductionOrderStatus" ADD VALUE 'pendiente_calidad';

CREATE TYPE "QualityResult" AS ENUM ('aprobado', 'rechazado');

CREATE TABLE "quality_checks" (
    "id" SERIAL NOT NULL,
    "production_order_id" INTEGER NOT NULL,
    "result" "QualityResult" NOT NULL,
    "observations" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_checks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "quality_checks_production_order_id_key" ON "quality_checks"("production_order_id");

ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
