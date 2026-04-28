import express from "express";
import {
  directRouting,
  loopRouting,
  addPoiToRoute,
  loopPoiSuggestions,
} from "../controllers/routeGenerationController.js";
import {
  aiRouting,
  aiRoutingStream,
} from "../controllers/aiRoutingController.js";
import {
  saveRoute,
  listSavedRoutes,
  getSavedRoute,
  updateSavedRoute,
  deleteSavedRoute,
} from "../controllers/savedRoutesController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import {
  atoBSchema,
  loopSchema,
  aiRouteSchema,
  saveRouteSchema,
  updateRouteSchema,
  loopPoiSuggestSchema,
  addPoiSchema,
} from "../validators/routeValidators.js";

export default function buildRoutesRouter(generateLimiter) {
  const router = express.Router();

  router.post(
    "/generate",
    authMiddleware,
    generateLimiter,
    validate(atoBSchema),
    directRouting,
  );
  router.post(
    "/generate-loop",
    authMiddleware,
    generateLimiter,
    validate(loopSchema),
    loopRouting,
  );
  router.post(
    "/generate-ai",
    authMiddleware,
    generateLimiter,
    validate(aiRouteSchema),
    aiRouting,
  );
  router.post(
    "/generate-ai/stream",
    authMiddleware,
    generateLimiter,
    validate(aiRouteSchema),
    aiRoutingStream,
  );
  router.post(
    "/add-poi",
    authMiddleware,
    generateLimiter,
    validate(addPoiSchema),
    addPoiToRoute,
  );
  router.post(
    "/loop-pois",
    authMiddleware,
    generateLimiter,
    validate(loopPoiSuggestSchema),
    loopPoiSuggestions,
  );

  router.post("/saved", authMiddleware, validate(saveRouteSchema), saveRoute);
  router.get("/saved", authMiddleware, listSavedRoutes);
  router.get("/saved/:id", authMiddleware, getSavedRoute);
  router.patch(
    "/saved/:id",
    authMiddleware,
    validate(updateRouteSchema),
    updateSavedRoute,
  );
  router.delete("/saved/:id", authMiddleware, deleteSavedRoute);

  return router;
}
