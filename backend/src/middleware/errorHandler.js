import { sendError, Errors } from "../utils/responses.js";

export const errorHandler = (err, req, res, next) => {
  if (process.env.NODE_ENV === "production") {
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
