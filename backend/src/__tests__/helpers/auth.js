import jwt from "jsonwebtoken";

export const makeAccessToken = (userId = "user-1") =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "1h" });

export const authHeader = (userId = "user-1") => ({
  Authorization: `Bearer ${makeAccessToken(userId)}`,
});
