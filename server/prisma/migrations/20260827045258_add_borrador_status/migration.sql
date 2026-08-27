-- El cliente pidió un paso de "borrador" antes de que la OP quede visible
-- para los operarios de planta: Gestión la crea, termina de cargar materia
-- prima/medidas/cliente/referencia, y recién al liberarla (POST
-- /:id/release) pasa a "pendiente" y aparece en la cola de la estación.

ALTER TYPE "ProductionOrderStatus" ADD VALUE 'borrador';
