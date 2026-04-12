-- AlterTable
ALTER TABLE "Route" ADD COLUMN     "saveCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "RouteSave" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteSave_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RouteSave_routeId_idx" ON "RouteSave"("routeId");

-- CreateIndex
CREATE INDEX "RouteSave_userId_idx" ON "RouteSave"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RouteSave_userId_routeId_key" ON "RouteSave"("userId", "routeId");

-- CreateIndex
CREATE INDEX "Route_isPublic_startLat_startLng_idx" ON "Route"("isPublic", "startLat", "startLng");

-- CreateIndex
CREATE INDEX "Route_isPublic_saveCount_idx" ON "Route"("isPublic", "saveCount");

-- AddForeignKey
ALTER TABLE "RouteSave" ADD CONSTRAINT "RouteSave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteSave" ADD CONSTRAINT "RouteSave_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;
