import { sendError, Errors } from "../utils/responses.js";

export const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    return sendError(res, Errors.INVALID_REQUEST, {
      issues: result.error.issues.map((issue) => ({
        field: issue.path[0],
        message: issue.message,
      })),
    });
  }

  req.body = result.data;
  next();
};
