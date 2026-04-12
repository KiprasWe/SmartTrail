import express from "express";
import {
  directRouting,
  loopRouting,
} from "../controllers/routeGenerationController.js";
import { aiRouting, aiRoutingStream } from "../controllers/aiRoutingController.js";
import {
  saveRoute,
  listSavedRoutes,
  getSavedRoute,
  updateSavedRoute,
  deleteSavedRoute,
  discoverRoutes,
  getPublicRoute,
  savePublicRoute,
  unsavePublicRoute,
} from "../controllers/savedRoutesController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import {
  atoBSchema,
  loopSchema,
  aiRouteSchema,
  saveRouteSchema,
  updateRouteSchema,
  discoverQuerySchema,
} from "../validators/routeValidators.js";

const router = express.Router();

// Route generation — all require authentication so the per-user rate limiter
// in server.js can key on req.user.id instead of falling back to IP.
router.post("/generate", authMiddleware, validate(atoBSchema), directRouting);
router.post("/generate-loop", authMiddleware, validate(loopSchema), loopRouting);
router.post("/generate-ai", authMiddleware, validate(aiRouteSchema), aiRouting);
router.post(
  "/generate-ai/stream",
  authMiddleware,
  validate(aiRouteSchema),
  aiRoutingStream,
);

// Saved routes CRUD — all require auth
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

export default router;

// Discover (community routes) — mounted on a separate router in server.js so
// it isn't subject to the 10/min generateLimiter (browse endpoints get hit on
// every map pan). Still auth-gated and still under the 100/min global limit.
export const discoverRouter = express.Router();

discoverRouter.get(
  "/discover",
  authMiddleware,
  validate(discoverQuerySchema, "query"),
  discoverRoutes,
);
discoverRouter.get("/public/:id", authMiddleware, getPublicRoute);
discoverRouter.post("/public/:id/save", authMiddleware, savePublicRoute);
discoverRouter.delete("/public/:id/save", authMiddleware, unsavePublicRoute);
