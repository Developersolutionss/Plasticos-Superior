-- Toda la cadena de derivación de una OP (extrusión → sellado → ...) ahora
-- comparte el mismo order_number del padre raíz, en vez de que cada etapa
-- reciba un consecutivo nuevo. Se quita la unicidad para permitirlo.
DROP INDEX "production_orders_order_number_key";
