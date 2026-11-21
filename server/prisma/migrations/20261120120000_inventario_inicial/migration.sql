-- Ingreso de inventario inicial (pedido del cliente 2026-11-20): marca las
-- OPs que solo registran rollos que ya estaban en bodega. Solo agrega una
-- columna con default false: no toca ni borra datos.
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "opening_stock" BOOLEAN NOT NULL DEFAULT false;
