/*
  Warnings:

  - You are about to drop the column `isPublic` on the `Route` table. All the data in the column will be lost.
  - You are about to drop the column `saveCount` on the `Route` table. All the data in the column will be lost.
  - You are about to drop the column `isPublic` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `Follow` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RouteSave` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Follow" DROP CONSTRAINT "Follow_followerId_fkey";

-- DropForeignKey
ALTER TABLE "Follow" DROP CONSTRAINT "Follow_followingId_fkey";

-- DropForeignKey
ALTER TABLE "RouteSave" DROP CONSTRAINT "RouteSave_routeId_fkey";

-- DropForeignKey
ALTER TABLE "RouteSave" DROP CONSTRAINT "RouteSave_userId_fkey";

-- DropIndex
DROP INDEX "Route_isPublic_saveCount_idx";

-- DropIndex
DROP INDEX "Route_isPublic_startLat_startLng_idx";

-- AlterTable
ALTER TABLE "Route" DROP COLUMN "isPublic",
DROP COLUMN "saveCount";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "isPublic";

-- DropTable
DROP TABLE "Follow";

-- DropTable
DROP TABLE "RouteSave";

-- DropEnum
DROP TYPE "FollowStatus";
