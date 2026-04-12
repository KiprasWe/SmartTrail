import "dotenv/config";

import express from "express";
import cors from "cors";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { config } from "dotenv";
import { connectDB, disconnectDB } from "./config/db.js";

import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import routesRoutes, { discoverRouter } from "./routes/routesRoutes.js";
import socialRoutes from "./routes/socialRoutes.js";
import { placePhoto } from "./controllers/savedRoutesController.js";

import { errorHandler } from "./middleware/errorHandler.js";
import { startCleanupJob } from "./jobs/cleanupRefreshTokens.js";

config();
connectDB();
startCleanupJob();

const app = express();

// Railway (and most PaaS) terminate TLS at the edge and forward plain HTTP
// internally. Without trust proxy, req.protocol is always "http" even for
// HTTPS requests, which causes the redirect below to loop infinitely.
app.set("trust proxy", 1);

// HTTPS redirect + HSTS in production
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

const globalLimiter = rateLimit({ windowMs: 60_000, max: 100 });
const authLimiter = rateLimit({ windowMs: 60_000, max: 10 });
const generateLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req),
});

const sensitiveOpsLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req),
  message: { status: "error", code: "RATE_LIMITED" },
});

app.use(globalLimiter);

// Health check — unauthenticated, no rate limit, used by LB probes.
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/auth", authLimiter, authRoutes);
app.use("/user", userRoutes(sensitiveOpsLimiter));
// Photo proxy is mounted outside the generateLimiter — fetching POI thumbnails
// must not eat into the 10/min route generation budget.
app.get("/places/photo", placePhoto);
// Discover endpoints also live outside generateLimiter: browsing public
// routes on map pan would otherwise starve the generation budget.
app.use("/routes", discoverRouter);
app.use("/routes", generateLimiter, routesRoutes);
app.use("/social", socialRoutes);

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
