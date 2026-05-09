import express from "express";
import {
  directRouting,
  loopRouting,
  splicePoi,
  rerouteDirect,
  rerouteLoop,
} from "../controllers/routeGenerationController.js";
import { aiRoutingStream } from "../controllers/aiRoutingController.js";
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
  rerouteDirectSchema,
  rerouteLoopSchema,
  saveRouteSchema,
  updateRouteSchema,
  splicePoiSchema,
} from "../validators/routeValidators.js";

export default function buildRoutesRouter() {
  const router = express.Router();

  router.post("/generate", authMiddleware, validate(atoBSchema), directRouting);

  router.post(
    "/generate-loop",
    authMiddleware,
    validate(loopSchema),
    loopRouting,
  );

  router.post(
    "/generate-ai/stream",
    authMiddleware,
    validate(aiRouteSchema),
    aiRoutingStream,
  );

  // POI via-waypoint edits (same behaviour for simple + AI modes).
  router.post(
    "/add-poi-direct",
    authMiddleware,
    validate(rerouteDirectSchema),
    rerouteDirect,
  );
  router.post(
    "/remove-poi-direct",
    authMiddleware,
    validate(rerouteDirectSchema),
    rerouteDirect,
  );
  router.post(
    "/add-poi-loop",
    authMiddleware,
    validate(splicePoiSchema),
    splicePoi,
  );
  router.post(
    "/remove-poi-loop",
    authMiddleware,
    validate(rerouteLoopSchema),
    rerouteLoop,
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
