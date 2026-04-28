/*
  Warnings:

  - You are about to drop the column `aiPlan` on the `Route` table. All the data in the column will be lost.
  - You are about to drop the column `generationId` on the `Route` table. All the data in the column will be lost.
  - You are about to drop the column `instructions` on the `Route` table. All the data in the column will be lost.
  - You are about to drop the column `isFavorite` on the `Route` table. All the data in the column will be lost.
  - You are about to drop the column `variantLabel` on the `Route` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Route_generationId_idx";

-- AlterTable
ALTER TABLE "Route" DROP COLUMN "aiPlan",
DROP COLUMN "generationId",
DROP COLUMN "instructions",
DROP COLUMN "isFavorite",
DROP COLUMN "variantLabel";
