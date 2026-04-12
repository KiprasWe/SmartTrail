import { sendError, Errors } from "../utils/responses.js";

// `source` picks which part of the request to validate: "body" (default) or
// "query". Query params arrive as strings so the corresponding schemas are
// expected to use z.coerce.* where needed.
export const validate =
  (schema, source = "body") =>
  (req, res, next) => {
    if (source === "body" && req.file && Object.keys(req.body).length === 0) {
      return next();
    }

    const result = schema.safeParse(req[source]);

    if (!result.success) {
      return sendError(res, Errors.INVALID_REQUEST, {
        issues: result.error.issues.map((issue) => ({
          field: issue.path[0],
          message: issue.message,
        })),
      });
    }

    // Express 5 exposes req.query as a getter-only property, so we can't
    // reassign it. Mutate in place instead — safe because safeParse returned
    // a fresh object.
    if (source === "query") {
      for (const k of Object.keys(req.query)) delete req.query[k];
      Object.assign(req.query, result.data);
    } else {
      req[source] = result.data;
    }
    next();
  };
