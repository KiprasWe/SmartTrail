import express from "express";
import {
  getUserProfile,
  editUserProfile,
  setPassword,
  changePassword,
  completeOnboarding,
} from "../controllers/userController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import {
  editUserProfileSchema,
  setPasswordSchema,
  changePasswordSchema,
} from "../validators/userValidators.js";

export default function userRoutes() {
  const router = express.Router();
  router.use(authMiddleware);

  router.get("/me", getUserProfile);
  router.patch("/me", validate(editUserProfileSchema), editUserProfile);

  router.post("/me/set-password", validate(setPasswordSchema), setPassword);

  router.post(
    "/me/change-password",
    validate(changePasswordSchema),
    changePassword,
  );

  router.post("/me/complete-onboarding", completeOnboarding);

  return router;
}
