-- El cliente pidió poder cargar mas atributos al crear un producto (antes
-- solo existia "measure" como texto libre) y 3 categorias nuevas para el
-- material que se maneja en Extrusion.

ALTER TYPE "ProductCategory" ADD VALUE 'tubular';
ALTER TYPE "ProductCategory" ADD VALUE 'semitubular';
ALTER TYPE "ProductCategory" ADD VALUE 'laminado';

ALTER TABLE "products" ADD COLUMN "measure_unit" TEXT;
ALTER TABLE "products" ADD COLUMN "talla" TEXT;
ALTER TABLE "products" ADD COLUMN "color" TEXT;
ALTER TABLE "products" ADD COLUMN "densidad" TEXT;
ALTER TABLE "products" ADD COLUMN "medida_ref" TEXT;
ALTER TABLE "products" ADD COLUMN "calibre" TEXT;
