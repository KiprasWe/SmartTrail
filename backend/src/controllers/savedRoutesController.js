// controllers/savedRoutesController.js — saved routes CRUD, photo proxy
//
// Routes are stored as structured JSON in Postgres (geometry, bbox, instructions,
// elevation profile, POIs, AI plan) rather than GPX files. The structured form
// is queryable, editable, and the client can cache it directly for offline access.

import { asyncHandler } from "../utils/asyncHandler.js";
import { sendError, sendSuccess, Errors, Success } from "../utils/responses.js";
import { prisma } from "../config/db.js";
import { simplifyForThumbnail } from "../lib/geo.js";
import { fetchWithTimeout } from "../utils/http.js";

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const TIMEOUT_PLACES_MS = 15_000;
// Select shape for list views — omits the heavy POI payload and returns a
// simplified thumbnail polyline so the client can render a route silhouette.
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
  variantLabel: true,
  isFavorite: true,
  createdAt: true,
  updatedAt: true,
};

// ─── Google Places photo proxy ────────────────────────────────────────────────
//
// Google Places photo URLs require the API key. We don't want to ship that key
// to the client, so we ask Places for the resolved photo URL (skipHttpRedirect=true),
// then 302-redirect the client to the actual googleusercontent.com image.
const PHOTO_MAX_HEIGHT = 600;
const PHOTO_MAX_WIDTH = 800;

export const placePhoto = asyncHandler(async (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name : "";

  if (!name || !name.startsWith("places/")) {
    return res
      .status(400)
      .json({ status: "error", message: "Invalid photo name" });
  }
  if (!GOOGLE_PLACES_API_KEY) {
    return res
      .status(500)
      .json({ status: "error", message: "Places API key not configured" });
  }

  const encoded = name.split("/").map(encodeURIComponent).join("/");
  const url = `https://places.googleapis.com/v1/${encoded}/media?maxHeightPx=${PHOTO_MAX_HEIGHT}&maxWidthPx=${PHOTO_MAX_WIDTH}&skipHttpRedirect=true`;

  try {
    const r = await fetchWithTimeout(
      url,
      { headers: { "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY } },
      TIMEOUT_PLACES_MS,
    );
    if (!r.ok) {
      const text = await r.text();
      console.warn(`[placePhoto] upstream ${r.status}: ${text.slice(0, 200)}`);
      return res
        .status(r.status)
        .json({ status: "error", message: "Photo fetch failed" });
    }
    const data = await r.json();
    if (!data.photoUri) {
      return res.status(404).json({ status: "error", message: "No photo URI" });
    }
    res.set("Cache-Control", "public, max-age=86400");
    return res.redirect(302, data.photoUri);
  } catch (err) {
    console.error("[placePhoto] error:", err.message);
    return res
      .status(502)
      .json({ status: "error", message: "Photo proxy error" });
  }
});

// ─── Saved routes CRUD ────────────────────────────────────────────────────────

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
      instructions: data.instructions ?? null,
      elevationProfile: data.elevationProfile ?? null,
      startLat: data.startLat,
      startLng: data.startLng,
      startLabel: data.startLabel ?? null,
      endLat: data.endLat ?? null,
      endLng: data.endLng ?? null,
      endLabel: data.endLabel ?? null,
      aiPlan: data.aiPlan ?? null,
      pois: data.pois ?? null,
      variantLabel: data.variantLabel ?? null,
      generationId: data.generationId ?? null,
      isFavorite: data.isFavorite ?? false,
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

