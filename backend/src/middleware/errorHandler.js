import { sendError, Errors } from "../utils/responses.js";
import { isProduction } from "../config/env.js";

export const errorHandler = (err, req, res, next) => {
  if (isProduction()) {
    console.error(
      JSON.stringify({
        level: "error",
        method: req.method,
        path: req.path,
        message: err.message,
        code: err.code,
      }),
    );
  } else {
    console.error(`[${req.method} ${req.path}]`, err);
  }

  return sendError(res, Errors.INTERNAL_SERVER_ERROR);
};
