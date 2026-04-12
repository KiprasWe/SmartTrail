// controllers/savedRoutesController.js — saved routes CRUD, discover, public routes, photo proxy
//
// Routes are stored as structured JSON in Postgres (geometry, bbox, instructions,
// elevation profile, POIs, AI plan) rather than GPX files. The structured form
// is queryable, editable, and the client can cache it directly for offline access.

import { Prisma } from "@prisma/client";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendError, sendSuccess, Errors, Success } from "../utils/responses.js";
import { prisma } from "../config/db.js";
import { simplifyForThumbnail, boundingBox } from "../lib/geo.js";
import { fetchWithTimeout } from "../utils/http.js";

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const TIMEOUT_PLACES_MS = 15_000;
const EARTH_RADIUS_KM = 6371;

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
  isPublic: true,
  createdAt: true,
  updatedAt: true,
};

// ─── Google Places photo proxy ────────────────────────────────────────────────
//
// Google Places photo URLs require the API key. We don't want to ship that key
// to the client, so we ask Places for the resolved photo URL (skipHttpRedirect=true),
// then 302-redirect the client to the actual googleusercontent.com image.
export const placePhoto = asyncHandler(async (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name : "";
  const maxHeight = Math.min(
    Math.max(parseInt(req.query.maxHeight ?? "400", 10) || 400, 64),
    1600,
  );
  const maxWidth = Math.min(
    Math.max(parseInt(req.query.maxWidth ?? "400", 10) || 400, 64),
    1600,
  );

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
  const url = `https://places.googleapis.com/v1/${encoded}/media?maxHeightPx=${maxHeight}&maxWidthPx=${maxWidth}&skipHttpRedirect=true`;

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
      isPublic: data.isPublic ?? false,
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
  if (route.userId !== userId && !route.isPublic) {
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

// ─── Discover (community routes) ──────────────────────────────────────────────

export const discoverRoutes = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const {
    lat,
    lng,
    radiusKm,
    transport,
    minDistanceKm,
    maxDistanceKm,
    sort,
    cursor,
    limit,
  } = req.query;

  const box = boundingBox(Number(lat), Number(lng), Number(radiusKm));
  const fetchLimit = Number(limit) + 1;

  const latNum = Number(lat);
  const lngNum = Number(lng);
  const radiusNum = Number(radiusKm);

  const transportSql = transport
    ? Prisma.sql`AND "transport" = ${transport}`
    : Prisma.empty;
  const minDistSql =
    typeof minDistanceKm !== "undefined"
      ? Prisma.sql`AND "distance" >= ${Math.round(Number(minDistanceKm) * 1000)}`
      : Prisma.empty;
  const maxDistSql =
    typeof maxDistanceKm !== "undefined"
      ? Prisma.sql`AND "distance" <= ${Math.round(Number(maxDistanceKm) * 1000)}`
      : Prisma.empty;

  let cursorSql = Prisma.empty;
  if (cursor) {
    try {
      const decoded = Buffer.from(cursor, "base64").toString("utf8");
      const [sortValueRaw, cursorId] = decoded.split(":");
      const sortValue = Number(sortValueRaw);
      if (Number.isFinite(sortValue) && cursorId) {
        cursorSql =
          sort === "popular"
            ? Prisma.sql`AND ("saveCount", "id") < (${sortValue}, ${cursorId})`
            : Prisma.sql`AND (distance_km, "id") > (${sortValue}, ${cursorId})`;
      }
    } catch {
      // Bad cursor → treat as first page
    }
  }

  const orderSql =
    sort === "popular"
      ? Prisma.sql`ORDER BY "saveCount" DESC, "id" DESC`
      : Prisma.sql`ORDER BY distance_km ASC, "id" ASC`;

  const rows = await prisma.$queryRaw`
    SELECT * FROM (
      SELECT
        "id", "userId", "title", "description", "mode", "transport",
        "distance", "duration", "ascent", "descent", "bbox", "geometry",
        "startLat", "startLng", "startLabel", "endLat", "endLng", "endLabel",
        "variantLabel", "saveCount", "createdAt",
        (
          ${EARTH_RADIUS_KM} * 2 * ASIN(SQRT(
            POWER(SIN(RADIANS("startLat" - ${latNum}) / 2), 2) +
            COS(RADIANS(${latNum})) * COS(RADIANS("startLat")) *
            POWER(SIN(RADIANS("startLng" - ${lngNum}) / 2), 2)
          ))
        ) AS distance_km
      FROM "Route"
      WHERE "isPublic" = true
        AND "userId" <> ${userId}
        AND "startLat" BETWEEN ${box.minLat} AND ${box.maxLat}
        AND "startLng" BETWEEN ${box.minLng} AND ${box.maxLng}
        ${transportSql}
        ${minDistSql}
        ${maxDistSql}
    ) AS candidates
    WHERE distance_km <= ${radiusNum}
      ${cursorSql}
    ${orderSql}
    LIMIT ${fetchLimit}
  `;

  const hasMore = rows.length > Number(limit);
  const page = hasMore ? rows.slice(0, Number(limit)) : rows;

  const ids = page.map((r) => r.id);
  const savedRows = ids.length
    ? await prisma.routeSave.findMany({
        where: { userId, routeId: { in: ids } },
        select: { routeId: true },
      })
    : [];
  const savedSet = new Set(savedRows.map((s) => s.routeId));

  const authorIds = [...new Set(page.map((r) => r.userId))];
  const authors = authorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, username: true, profilePicture: true },
      })
    : [];
  const authorMap = new Map(authors.map((a) => [a.id, a]));

  const routes = page.map((r) => {
    const { geometry, userId: authorId, ...rest } = r;
    return {
      ...rest,
      distanceKm: Number(r.distance_km),
      distance_km: undefined,
      saveCount: Number(r.saveCount),
      savedByMe: savedSet.has(r.id),
      author: authorMap.get(authorId) ?? null,
      thumbnail: simplifyForThumbnail(geometry),
    };
  });

  let nextCursor = null;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1];
    const sortValue =
      sort === "popular" ? Number(last.saveCount) : Number(last.distance_km);
    nextCursor = Buffer.from(`${sortValue}:${last.id}`).toString("base64");
  }

  return sendSuccess(res, Success.DISCOVER_FETCHED, { routes, nextCursor });
});

export const getPublicRoute = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  const route = await prisma.route.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, username: true, profilePicture: true } },
    },
  });
  if (!route) return sendError(res, Errors.ROUTE_NOT_FOUND);
  if (!route.isPublic && route.userId !== userId) {
    return sendError(res, Errors.ROUTE_NOT_PUBLIC);
  }

  const savedByMe = !!(await prisma.routeSave.findUnique({
    where: { userId_routeId: { userId, routeId: id } },
    select: { id: true },
  }));

  const { user, ...rest } = route;
  return sendSuccess(res, Success.ROUTE_FETCHED, {
    route: { ...rest, author: user, savedByMe },
  });
});

export const savePublicRoute = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  const route = await prisma.route.findUnique({
    where: { id },
    select: { id: true, userId: true, isPublic: true },
  });
  if (!route) return sendError(res, Errors.ROUTE_NOT_FOUND);
  if (!route.isPublic) return sendError(res, Errors.ROUTE_NOT_PUBLIC);
  if (route.userId === userId) {
    return sendError(res, Errors.CANNOT_SAVE_OWN_ROUTE);
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.routeSave.create({ data: { userId, routeId: id } });
      return tx.route.update({
        where: { id },
        data: { saveCount: { increment: 1 } },
        select: { id: true, saveCount: true },
      });
    });
    return sendSuccess(res, Success.ROUTE_SAVED_TO_LIST, {
      routeId: updated.id,
      saveCount: updated.saveCount,
    });
  } catch (err) {
    if (err?.code === "P2002") {
      return sendError(res, Errors.ROUTE_ALREADY_SAVED);
    }
    throw err;
  }
});

export const unsavePublicRoute = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.routeSave.delete({
        where: { userId_routeId: { userId, routeId: id } },
      });
      return tx.route.update({
        where: { id },
        data: { saveCount: { decrement: 1 } },
        select: { id: true, saveCount: true },
      });
    });
    return sendSuccess(res, Success.ROUTE_UNSAVED_FROM_LIST, {
      routeId: updated.id,
      saveCount: Math.max(0, updated.saveCount),
    });
  } catch (err) {
    if (err?.code === "P2025") {
      return sendError(res, Errors.ROUTE_SAVE_NOT_FOUND);
    }
    throw err;
  }
});
