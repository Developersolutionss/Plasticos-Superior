/*
  Warnings:

  - Made the column `possession_token_hash` on table `production_rolls` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "production_rolls" ALTER COLUMN "possession_token_hash" SET NOT NULL;
