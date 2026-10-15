-- AlterTable
ALTER TABLE "users" ADD COLUMN     "recoveryHash" TEXT,
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;
