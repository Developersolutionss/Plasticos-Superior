-- Nueva estación Embobinado (pedido del cliente 2026-11-09): se deriva solo
-- desde Extrusión, trabaja igual que Sellado, tiene su propio rol de operario
-- y su propia bodega para los traslados de rollos. Solo agrega valores a los
-- enums: no toca ni borra datos.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'operario_embobinado';
ALTER TYPE "ProductionStation" ADD VALUE IF NOT EXISTS 'embobinado';
ALTER TYPE "RollWarehouse" ADD VALUE IF NOT EXISTS 'embobinado';
