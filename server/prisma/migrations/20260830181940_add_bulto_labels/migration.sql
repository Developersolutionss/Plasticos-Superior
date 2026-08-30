-- CreateEnum
CREATE TYPE "BultoLabelStatus" AS ENUM ('disponible', 'usada');

-- CreateTable
CREATE TABLE "bulto_labels" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "status" "BultoLabelStatus" NOT NULL DEFAULT 'disponible',
    "used_by_roll_id" INTEGER,
    "used_by" INTEGER,
    "used_at" TIMESTAMP(3),
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulto_labels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bulto_labels_code_key" ON "bulto_labels"("code");

-- CreateIndex
CREATE UNIQUE INDEX "bulto_labels_used_by_roll_id_key" ON "bulto_labels"("used_by_roll_id");

-- AddForeignKey
ALTER TABLE "bulto_labels" ADD CONSTRAINT "bulto_labels_used_by_roll_id_fkey" FOREIGN KEY ("used_by_roll_id") REFERENCES "production_rolls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulto_labels" ADD CONSTRAINT "bulto_labels_used_by_fkey" FOREIGN KEY ("used_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulto_labels" ADD CONSTRAINT "bulto_labels_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
