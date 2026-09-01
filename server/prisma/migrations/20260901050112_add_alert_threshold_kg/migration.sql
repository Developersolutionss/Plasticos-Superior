-- A cuántos kg (peso+desperdicio) avisarle a Gestión que la OP está por
-- completarse; null = usa el default (90% de quantity_planned).
ALTER TABLE "production_orders" ADD COLUMN "alert_threshold_kg" DECIMAL(12,2);
