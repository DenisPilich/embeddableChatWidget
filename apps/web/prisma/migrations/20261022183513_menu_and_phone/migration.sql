-- CreateEnum
CREATE TYPE "MenuAction" AS ENUM ('ANSWER', 'OPERATOR', 'SUBMENU', 'AI');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "calledBackAt" TIMESTAMP(3),
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "handoverTimeoutSeconds" INTEGER NOT NULL DEFAULT 300;

-- CreateTable
CREATE TABLE "menu_options" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "parentId" TEXT,
    "label" TEXT NOT NULL,
    "action" "MenuAction" NOT NULL DEFAULT 'ANSWER',
    "answer" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "menu_options_siteId_parentId_position_idx" ON "menu_options"("siteId", "parentId", "position");

-- AddForeignKey
ALTER TABLE "menu_options" ADD CONSTRAINT "menu_options_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_options" ADD CONSTRAINT "menu_options_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "menu_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;
