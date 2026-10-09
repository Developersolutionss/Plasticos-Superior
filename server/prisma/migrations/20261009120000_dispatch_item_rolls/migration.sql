-- Rollos/bultos exactos que salen hacia un cliente en cada ítem de despacho
-- (se escanean al despachar). Un despacho cancelado libera sus rollos.
CREATE TABLE "dispatch_item_rolls" (
    "id" SERIAL NOT NULL,
    "dispatch_item_id" INTEGER NOT NULL,
    "roll_id" INTEGER NOT NULL,
    "weight_kg" DECIMAL(12,2) NOT NULL,
    "scanned_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispatch_item_rolls_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dispatch_item_rolls_dispatch_item_id_roll_id_key" ON "dispatch_item_rolls"("dispatch_item_id", "roll_id");
CREATE INDEX "dispatch_item_rolls_roll_id_idx" ON "dispatch_item_rolls"("roll_id");

ALTER TABLE "dispatch_item_rolls" ADD CONSTRAINT "dispatch_item_rolls_dispatch_item_id_fkey" FOREIGN KEY ("dispatch_item_id") REFERENCES "dispatch_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dispatch_item_rolls" ADD CONSTRAINT "dispatch_item_rolls_roll_id_fkey" FOREIGN KEY ("roll_id") REFERENCES "production_rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispatch_item_rolls" ADD CONSTRAINT "dispatch_item_rolls_scanned_by_fkey" FOREIGN KEY ("scanned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
