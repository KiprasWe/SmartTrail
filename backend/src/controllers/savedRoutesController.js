import { asyncHandler } from "../utils/asyncHandler.js";
import { sendError, sendSuccess, Errors, Success } from "../utils/responses.js";
import { prisma } from "../config/db.js";
import { Prisma } from "@prisma/client";
import { simplifyForThumbnail } from "../lib/geo.js";

const SAVED_ROUTE_LIST_SELECT = {
  id: true,
  title: true,
  description: true,
  transport: true,
  distance: true,
  duration: true,
  ascent: true,
  descent: true,
  bbox: true,
  createdAt: true,
  updatedAt: true,
};

export const saveRoute = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const data = req.body;

  const [route] = await prisma.$queryRaw`
    INSERT INTO "Route" (id, "userId", title, description, transport, distance, duration, ascent, descent, geometry, bbox, "elevationProfile", pois, "createdAt", "updatedAt")
    VALUES (
      gen_random_uuid(),
      ${userId},
      ${data.title},
      ${data.description ?? null},
      ${data.transport},
      ${data.distance}::integer,
      ${data.duration}::integer,
      ${data.ascent ?? null}::integer,
      ${data.descent ?? null}::integer,
      ST_GeomFromGeoJSON(${JSON.stringify(data.geometry)}),
      ${JSON.stringify(data.bbox)}::jsonb,
      ${data.elevationProfile ? JSON.stringify(data.elevationProfile) : null}::jsonb,
      ${data.pois ? JSON.stringify(data.pois) : null}::jsonb,
      NOW(),
      NOW()
    )
    RETURNING id, "userId", title, description, transport, distance, duration, ascent, descent,
              ST_AsGeoJSON(geometry)::json as geometry,
              bbox, "elevationProfile", pois, "createdAt", "updatedAt"
  `;

  return sendSuccess(res, Success.ROUTE_SAVED, { route });
});

export const listSavedRoutes = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const limit = Math.min(parseInt(req.query.limit ?? "50", 10) || 50, 100);
  const cursor = req.query.cursor;

  const rows = await prisma.route.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: SAVED_ROUTE_LIST_SELECT,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  let thumbnailMap = new Map();
  if (page.length > 0) {
    const thumbnailRows = await prisma.$queryRaw`
      SELECT id, ST_AsGeoJSON(geometry)::json as geometry
      FROM "Route"
      WHERE id IN (${Prisma.join(page.map((r) => r.id))})
    `;
    for (const row of thumbnailRows) {
      thumbnailMap.set(row.id, simplifyForThumbnail(row.geometry));
    }
  }

  const routes = page.map((r) => ({ ...r, thumbnail: thumbnailMap.get(r.id) ?? null }));
  return sendSuccess(res, Success.ROUTES_FETCHED, { routes, nextCursor });
});

export const getSavedRoute = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  const [route] = await prisma.$queryRaw`
    SELECT id, "userId", title, description, transport, distance, duration, ascent, descent,
           ST_AsGeoJSON(geometry)::json as geometry,
           bbox, "elevationProfile", pois, "createdAt", "updatedAt"
    FROM "Route"
    WHERE id = ${id}
  `;

  if (!route) return sendError(res, Errors.ROUTE_NOT_FOUND);
  if (route.userId !== userId) return sendError(res, Errors.ROUTE_ACCESS_DENIED);

  return sendSuccess(res, Success.ROUTE_FETCHED, { route });
});

export const updateSavedRoute = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  const existing = await prisma.route.findUnique({ where: { id } });
  if (!existing) return sendError(res, Errors.ROUTE_NOT_FOUND);
  if (existing.userId !== userId) return sendError(res, Errors.ROUTE_ACCESS_DENIED);

  const route = await prisma.route.update({
    where: { id },
    data: req.body,
  });

  return sendSuccess(res, Success.ROUTE_UPDATED, { route });
});

export const deleteSavedRoute = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  const existing = await prisma.route.findUnique({ where: { id } });
  if (!existing) return sendError(res, Errors.ROUTE_NOT_FOUND);
  if (existing.userId !== userId) return sendError(res, Errors.ROUTE_ACCESS_DENIED);

  await prisma.route.delete({ where: { id } });
  return sendSuccess(res, Success.ROUTE_DELETED, { id });
});
