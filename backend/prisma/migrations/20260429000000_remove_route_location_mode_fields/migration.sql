-- AlterTable
ALTER TABLE "Route" DROP COLUMN "endLat",
DROP COLUMN "endLng",
DROP COLUMN "endLabel",
DROP COLUMN "startLat",
DROP COLUMN "startLng",
DROP COLUMN "startLabel",
DROP COLUMN "mode";

-- DropEnum
DROP TYPE IF EXISTS "RouteMode";
