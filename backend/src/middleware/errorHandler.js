import { sendError, Errors } from "../utils/responses.js";

export const errorHandler = (err, req, res, next) => {
  console.error(err);
  return sendError(res, Errors.INTERNAL_SERVER_ERROR);
};
