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
import { uploadMiddleware } from "../middleware/uploadMiddleware.js";

// Accept the sensitiveOpsLimiter injected from server.js so we don't need to
// re-create a rate limiter here (it must share state with server.js's instance).
export default function userRoutes(sensitiveOpsLimiter) {
  const router = express.Router();

  router.use(authMiddleware);

  router.get("/me", getUserProfile);
  router.patch(
    "/me",
    uploadMiddleware,
    validate(editUserProfileSchema),
    editUserProfile,
  );
  router.post(
    "/me/set-password",
    sensitiveOpsLimiter,
    validate(setPasswordSchema),
    setPassword,
  );
  router.post(
    "/me/change-password",
    sensitiveOpsLimiter,
    validate(changePasswordSchema),
    changePassword,
  );
  router.post("/me/complete-onboarding", completeOnboarding);

  return router;
}
