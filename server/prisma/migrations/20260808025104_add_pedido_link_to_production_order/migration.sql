-- Vincula opcionalmente una Orden de Producción con el item de Pedido que la
-- originó (módulo Planeación). Nullable: las OP creadas manualmente (sin
-- pasar por Planeación) siguen sin este vínculo, tal como hasta ahora.
ALTER TABLE "production_orders" ADD COLUMN "pedido_version_item_id" INTEGER;

CREATE UNIQUE INDEX "production_orders_pedido_version_item_id_key" ON "production_orders"("pedido_version_item_id");

ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_pedido_version_item_id_fkey" FOREIGN KEY ("pedido_version_item_id") REFERENCES "pedido_version_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
