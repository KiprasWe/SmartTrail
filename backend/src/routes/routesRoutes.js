import express from "express";
import {
  generateAtoB,
  generateRoundTrip,
  generateAIRoute,
} from "../controllers/routesController.js";
import { validate } from "../middleware/validate.js";

const router = express.Router();

router.post("/generate-a-to-b", generateAtoB);
router.post("/generate-round-trip", generateRoundTrip);
router.post("/generate-ai", generateAIRoute);

export default router;
