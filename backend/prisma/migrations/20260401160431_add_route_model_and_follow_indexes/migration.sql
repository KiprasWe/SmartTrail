-- CreateEnum
CREATE TYPE "RouteMode" AS ENUM ('A_TO_B', 'LOOP', 'AI');

-- CreateTable
CREATE TABLE "Route" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "mode" "RouteMode" NOT NULL,
    "transport" TEXT NOT NULL,
    "distance" INTEGER NOT NULL,
    "duration" INTEGER NOT NULL,
    "ascent" INTEGER,
    "descent" INTEGER,
    "geometry" JSONB NOT NULL,
    "bbox" JSONB NOT NULL,
    "instructions" JSONB,
    "elevationProfile" JSONB,
    "startLat" DOUBLE PRECISION NOT NULL,
    "startLng" DOUBLE PRECISION NOT NULL,
    "startLabel" TEXT,
    "endLat" DOUBLE PRECISION,
    "endLng" DOUBLE PRECISION,
    "endLabel" TEXT,
    "aiPlan" JSONB,
    "pois" JSONB,
    "variantLabel" TEXT,
    "generationId" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Route_userId_idx" ON "Route"("userId");

-- CreateIndex
CREATE INDEX "Route_generationId_idx" ON "Route"("generationId");

-- CreateIndex
CREATE INDEX "Follow_followerId_idx" ON "Follow"("followerId");

-- CreateIndex
CREATE INDEX "Follow_followingId_idx" ON "Follow"("followingId");

-- CreateIndex
CREATE INDEX "Follow_followingId_status_idx" ON "Follow"("followingId", "status");

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
