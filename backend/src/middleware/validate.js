import { sendError, Errors } from "../utils/responses.js";

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

    if (source === "query") {
      for (const k of Object.keys(req.query)) delete req.query[k];
      Object.assign(req.query, result.data);
    } else {
      req[source] = result.data;
    }
    next();
  };
