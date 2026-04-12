import { sendError, Errors } from "../utils/responses.js";

export const errorHandler = (err, req, res, next) => {
  // Always log the full error server-side for debugging.
  // In production, keep the log structured and omit stack from the response.
  if (process.env.NODE_ENV === "production") {
    console.error(JSON.stringify({
      level: "error",
      method: req.method,
      path: req.path,
      message: err.message,
      code: err.code,
    }));
  } else {
    console.error(`[${req.method} ${req.path}]`, err);
  }

  // Never leak internal stack traces or raw DB/API messages to the client.
  return sendError(res, Errors.INTERNAL_SERVER_ERROR);
};
