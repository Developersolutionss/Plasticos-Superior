-- Una OP nueva ahora se crea sin proceso asignado (station = null) y recién
-- lo recibe cuando Gestión la deriva a Extrusión como primer paso explícito.
ALTER TABLE "production_orders" ALTER COLUMN "station" DROP NOT NULL;
ALTER TABLE "production_orders" ALTER COLUMN "station" DROP DEFAULT;
