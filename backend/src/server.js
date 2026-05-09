import "dotenv/config";

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { connectDB, disconnectDB } from "./config/db.js";

import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import buildRoutesRouter from "./routes/routesRoutes.js";

import { errorHandler } from "./middleware/errorHandler.js";
import { startCleanupJob } from "./jobs/cleanupRefreshTokens.js";

connectDB();
startCleanupJob();

const app = express();

app.set("trust proxy", 1);

if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    if (req.protocol !== "https") {
      return res.redirect(301, `https://${req.get("host")}${req.url}`);
    }
    res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });
}

const corsOrigin = process.env.CORS_ORIGIN;
if (!corsOrigin && process.env.NODE_ENV === "production") {
  console.error("CORS_ORIGIN env var is required in production");
  process.exit(1);
}

app.use(cors({ origin: corsOrigin ?? "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 80,
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/auth", authLimiter);
app.use("/user", apiLimiter);
app.use("/routes", apiLimiter);

app.use("/auth", authRoutes);
app.use("/user", userRoutes());
app.use("/routes", buildRoutesRouter());

app.use(errorHandler);

const PORT = process.env.PORT || 5001;

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
  server.close(async () => {
    await disconnectDB();
    process.exit(1);
  });
});

process.on("uncaughtException", async (err) => {
  console.error("Uncaught Exception:", err);
  await disconnectDB();
  process.exit(1);
});

process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(async () => {
    await disconnectDB();
    process.exit(0);
  });
});
