-- Etapa terminada vs. producto final: si la OP es el producto final (va a
-- Calidad y entra al inventario) o una etapa intermedia cuyo material sigue a
-- otra estación. NULL = sin decidir / OP anterior (manda el estado).
ALTER TABLE "production_orders" ADD COLUMN "is_final_stage" BOOLEAN;
