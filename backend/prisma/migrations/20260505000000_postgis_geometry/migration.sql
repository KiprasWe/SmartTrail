-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Add a temporary PostGIS column
ALTER TABLE "Route" ADD COLUMN "geometry_new" geometry(LineString, 4326);

-- Migrate existing GeoJSON data stored as jsonb into PostGIS geometry
UPDATE "Route" SET "geometry_new" = ST_GeomFromGeoJSON("geometry"::text);

-- Swap columns
ALTER TABLE "Route" DROP COLUMN "geometry";
ALTER TABLE "Route" RENAME COLUMN "geometry_new" TO "geometry";

-- Spatial index for proximity queries
CREATE INDEX "Route_geometry_idx" ON "Route" USING GIST ("geometry");
