-- Modulo Almacen/WMS: ubicaciones fisicas de bodega y cuanto de cada
-- producto hay en cada una. El stock total sigue viviendo en
-- inventory_stock; esto es la capa de "donde esta guardado", administrada
-- a mano por Almacen.
CREATE TABLE "warehouse_locations" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_locations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "warehouse_locations_code_key" ON "warehouse_locations"("code");

CREATE TABLE "stock_locations" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_locations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_locations_product_id_location_id_key" ON "stock_locations"("product_id", "location_id");

ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
