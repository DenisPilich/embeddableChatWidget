-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "answerFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "humanRequestedAt" TIMESTAMP(3);
