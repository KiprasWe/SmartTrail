import express from "express";
import {
  searchUsers,
  getUserProfile,
  sendFollowRequest,
  acceptFollowRequest,
  rejectFollowRequest,
  cancelFollowRequest,
  unfollowUser,
  removeFollower,
  getFollowers,
  getFollowing,
  getFollowRequests,
} from "../controllers/socialController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import { sendFollowRequestSchema } from "../validators/socialValidators.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/search/:username", searchUsers);
router.get("/profile/:userId", getUserProfile);
router.get("/requests", getFollowRequests);
router.get("/:userId/followers", getFollowers);
router.get("/:userId/following", getFollowing);

router.post("/follow", validate(sendFollowRequestSchema), sendFollowRequest);
router.post("/accept/:userId", acceptFollowRequest);
router.post("/reject/:userId", rejectFollowRequest);
router.delete("/cancel/:userId", cancelFollowRequest);
router.delete("/unfollow/:userId", unfollowUser);
router.delete("/remove/:userId", removeFollower);

export default router;
