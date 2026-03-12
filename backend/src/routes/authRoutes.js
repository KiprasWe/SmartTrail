import express from "express";
import {
  signup,
  signin,
  refresh,
  googleAuth,
  signout,
} from "../controllers/authController.js";
import { validate } from "../middleware/validate.js";
import {
  signupSchema,
  signinSchema,
  googleAuthSchema,
  signoutSchema,
  refreshSchema,
} from "../validators/authValidators.js";

const router = express.Router();

router.post("/signup", validate(signupSchema), signup);
router.post("/signin", validate(signinSchema), signin);
router.post("/refresh", validate(refreshSchema), refresh);
router.post("/signout", validate(signoutSchema), signout);
router.post("/google", validate(googleAuthSchema), googleAuth);

export default router;
