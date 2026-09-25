-- CreateEnum
CREATE TYPE "RollTransferMode" AS ENUM ('entrega', 'retiro');

-- CreateEnum
CREATE TYPE "RollTransferStatus" AS ENUM ('en_transito', 'recibido');

-- CreateTable
CREATE TABLE "roll_transfers" (
    "id" SERIAL NOT NULL,
    "roll_id" INTEGER NOT NULL,
    "from_station" "ProductionStation" NOT NULL,
    "to_station" "ProductionStation" NOT NULL,
    "mode" "RollTransferMode" NOT NULL,
    "carrier_name" TEXT NOT NULL,
    "registered_by" INTEGER NOT NULL,
    "client_timezone" TEXT NOT NULL,
    "client_utc_offset_minutes" INTEGER NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "RollTransferStatus" NOT NULL DEFAULT 'en_transito',
    "received_by" INTEGER,
    "received_at" TIMESTAMP(3),
    "received_timezone" TEXT,
    "received_utc_offset_minutes" INTEGER,

    CONSTRAINT "roll_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roll_transfers_roll_id_idx" ON "roll_transfers"("roll_id");

-- CreateIndex
CREATE INDEX "roll_transfers_to_station_created_at_idx" ON "roll_transfers"("to_station", "created_at");

-- AddForeignKey
ALTER TABLE "roll_transfers" ADD CONSTRAINT "roll_transfers_roll_id_fkey" FOREIGN KEY ("roll_id") REFERENCES "production_rolls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_transfers" ADD CONSTRAINT "roll_transfers_registered_by_fkey" FOREIGN KEY ("registered_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_transfers" ADD CONSTRAINT "roll_transfers_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
