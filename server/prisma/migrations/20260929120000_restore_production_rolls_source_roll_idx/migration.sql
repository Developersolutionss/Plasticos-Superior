-- Recrea el índice de production_rolls.source_roll_id. Lo había creado a mano
-- 20260917170714_roll_consumption_ledger sin declararlo en schema.prisma, y
-- 20260929054645_add_production_order_presets lo borró al generarse (Prisma
-- lo vio como drift). Ahora está declarado en el schema (@@index([sourceRollId])).
CREATE INDEX IF NOT EXISTS "production_rolls_source_roll_id_idx" ON "production_rolls"("source_roll_id");
