/*
  Warnings:

  - Made the column `geometry` on table `Route` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "Route_geometry_idx";

-- AlterTable
ALTER TABLE "Route" ALTER COLUMN "geometry" SET NOT NULL;
