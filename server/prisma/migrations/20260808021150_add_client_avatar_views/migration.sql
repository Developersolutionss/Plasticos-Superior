-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "avatar_url" TEXT,
ADD COLUMN     "last_viewed_at" TIMESTAMP(3),
ADD COLUMN     "view_count" INTEGER NOT NULL DEFAULT 0;
