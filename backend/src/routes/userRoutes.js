import express from "express";
import {
  getUserProfile,
  editUserProfile,
  setPassword,
} from "../controllers/userController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import {
  editUserProfileSchema,
  setPasswordSchema,
} from "../validators/userValidators.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/me", getUserProfile);
router.patch("/me", validate(editUserProfileSchema), editUserProfile);
router.post("/me/set-password", validate(setPasswordSchema), setPassword);

export default router;
