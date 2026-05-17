import express from "express";
import { directRouting, loopRouting } from "../controllers/routeController.js";
import {
  splicePoi,
  unsplicePoi,
  rerouteDirect,
} from "../controllers/routeEditController.js";
import { aiRoutingStream } from "../controllers/aiRouteController.js";
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
  aiDirectSchema,
  aiLoopSchema,
  rerouteDirectSchema,
  saveRouteSchema,
  updateRouteSchema,
  splicePoiSchema,
} from "../validators/routeValidators.js";

export default function buildRoutesRouter() {
  const router = express.Router();
  router.use(authMiddleware);

  router.post("/generate-direct", validate(atoBSchema), directRouting);
  router.post("/generate-loop", validate(loopSchema), loopRouting);
  router.post("/generate-ai-direct", validate(aiDirectSchema), aiRoutingStream);
  router.post("/generate-ai-loop", validate(aiLoopSchema), aiRoutingStream);
  router.post("/add-poi-direct", validate(rerouteDirectSchema), rerouteDirect);
  router.post(
    "/remove-poi-direct",
    validate(rerouteDirectSchema),
    rerouteDirect,
  );
  router.post("/add-poi-loop", validate(splicePoiSchema), splicePoi);
  router.post("/remove-poi-loop", validate(splicePoiSchema), unsplicePoi);
  router.post("/saved", validate(saveRouteSchema), saveRoute);
  router.get("/saved", listSavedRoutes);
  router.get("/saved/:id", getSavedRoute);
  router.patch("/saved/:id", validate(updateRouteSchema), updateSavedRoute);
  router.delete("/saved/:id", deleteSavedRoute);

  return router;
}
