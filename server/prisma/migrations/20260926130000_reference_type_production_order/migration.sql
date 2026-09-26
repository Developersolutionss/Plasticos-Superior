-- Tipo de referencia propio para las entradas de inventario que vienen de
-- una OP (aprobación de Calidad y su reversión al reabrir). Antes se
-- guardaban como "manual_adjustment" y no había forma de saber de qué OP
-- salió ese stock.
ALTER TYPE "ReferenceType" ADD VALUE IF NOT EXISTS 'production_order';
