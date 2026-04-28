import { asyncHandler } from "../utils/asyncHandler.js";
import { sendError, sendSuccess, Errors, Success } from "../utils/responses.js";
import { prisma } from "../config/db.js";
import { simplifyForThumbnail } from "../lib/geo.js";
import { fetchWithTimeout } from "../utils/http.js";

const TIMEOUT_PLACES_MS = 15_000;
const SAVED_ROUTE_LIST_SELECT = {
  id: true,
  title: true,
  description: true,
  mode: true,
  transport: true,
  distance: true,
  duration: true,
  ascent: true,
  descent: true,
  geometry: true,
  bbox: true,
  startLat: true,
  startLng: true,
  startLabel: true,
  endLat: true,
  endLng: true,
  endLabel: true,
  createdAt: true,
  updatedAt: true,
};

export const saveRoute = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const data = req.body;

  const route = await prisma.route.create({
    data: {
      userId,
      title: data.title,
      description: data.description ?? null,
      mode: data.mode,
      transport: data.transport,
      distance: data.distance,
      duration: data.duration,
      ascent: data.ascent ?? null,
      descent: data.descent ?? null,
      geometry: data.geometry,
      bbox: data.bbox,
      elevationProfile: data.elevationProfile ?? null,
      startLat: data.startLat,
      startLng: data.startLng,
      startLabel: data.startLabel ?? null,
      endLat: data.endLat ?? null,
      endLng: data.endLng ?? null,
      endLabel: data.endLabel ?? null,
      pois: data.pois ?? null,
    },
  });

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

  const routes = page.map(({ geometry, ...rest }) => ({
    ...rest,
    thumbnail: simplifyForThumbnail(geometry),
  }));
  return sendSuccess(res, Success.ROUTES_FETCHED, { routes, nextCursor });
});

export const getSavedRoute = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  const route = await prisma.route.findUnique({ where: { id } });
  if (!route) return sendError(res, Errors.ROUTE_NOT_FOUND);
  if (route.userId !== userId) {
    return sendError(res, Errors.ROUTE_ACCESS_DENIED);
  }

  return sendSuccess(res, Success.ROUTE_FETCHED, { route });
});

export const updateSavedRoute = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  const existing = await prisma.route.findUnique({ where: { id } });
  if (!existing) return sendError(res, Errors.ROUTE_NOT_FOUND);
  if (existing.userId !== userId) {
    return sendError(res, Errors.ROUTE_ACCESS_DENIED);
  }

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
  if (existing.userId !== userId) {
    return sendError(res, Errors.ROUTE_ACCESS_DENIED);
  }

  await prisma.route.delete({ where: { id } });
  return sendSuccess(res, Success.ROUTE_DELETED, { id });
});
