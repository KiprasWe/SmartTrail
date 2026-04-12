export const Errors = {
  USER_EMAIL_EXISTS: { code: "USER_EMAIL_EXISTS", status: 400 },
  USER_USERNAME_EXISTS: { code: "USER_USERNAME_EXISTS", status: 400 },
  PASSWORDS_DO_NOT_MATCH: { code: "PASSWORDS_DO_NOT_MATCH", status: 400 },
  PASSWORD_TOO_SHORT: { code: "PASSWORD_TOO_SHORT", status: 400 },
  PASSWORD_NO_NUMBER: { code: "PASSWORD_NO_NUMBER", status: 400 },
  PASSWORD_ALREADY_SET: { code: "PASSWORD_ALREADY_SET", status: 400 },
  NO_PASSWORD_SET: { code: "NO_PASSWORD_SET", status: 400 },
  INVALID_CURRENT_PASSWORD: { code: "INVALID_CURRENT_PASSWORD", status: 401 },
  INVALID_LOGIN: { code: "INVALID_LOGIN", status: 401 },
  NO_ID_TOKEN: { code: "NO_ID_TOKEN", status: 400 },
  ID_TOKEN_INVALID: { code: "ID_TOKEN_INVALID", status: 401 },
  NO_REFRESH_TOKEN: { code: "NO_REFRESH_TOKEN", status: 400 },
  INVALID_REFRESH_TOKEN: { code: "INVALID_REFRESH_TOKEN", status: 401 },
  REFRESH_TOKEN_EXPIRED: { code: "REFRESH_TOKEN_EXPIRED", status: 401 },

  INVALID_REQUEST: { code: "INVALID_REQUEST", status: 400 },

  // Social
  USER_NOT_FOUND: { code: "USER_NOT_FOUND", status: 404 },
  CANNOT_FOLLOW_SELF: { code: "CANNOT_FOLLOW_SELF", status: 400 },
  FOLLOW_ALREADY_EXISTS: { code: "FOLLOW_ALREADY_EXISTS", status: 400 },
  ALREADY_FOLLOWING: { code: "ALREADY_FOLLOWING", status: 400 },
  FOLLOW_REQUEST_NOT_FOUND: { code: "FOLLOW_REQUEST_NOT_FOUND", status: 404 },
  NOT_FOLLOWING: { code: "NOT_FOLLOWING", status: 404 },
  NOT_A_FOLLOWER: { code: "NOT_A_FOLLOWER", status: 404 },

  BAD_REQUEST: { code: "BAD_REQUEST", status: 400 },
  EXTERNAL_SERVICE_ERROR: { code: "EXTERNAL_SERVICE_ERROR", status: 502 },
  INTERNAL_SERVER_ERROR: { code: "INTERNAL_SERVER_ERROR", status: 500 },

  // Routes
  ROUTE_NOT_FOUND: { code: "ROUTE_NOT_FOUND", status: 404 },
  VALHALLA_ERROR: { code: "VALHALLA_ERROR", status: 502 },
  AI_GENERATION_FAILED: { code: "AI_GENERATION_FAILED", status: 502 },
  ROUTE_ACCESS_DENIED: { code: "ROUTE_ACCESS_DENIED", status: 403 },
  ROUTE_NOT_PUBLIC: { code: "ROUTE_NOT_PUBLIC", status: 403 },
  ROUTE_ALREADY_SAVED: { code: "ROUTE_ALREADY_SAVED", status: 400 },
  ROUTE_SAVE_NOT_FOUND: { code: "ROUTE_SAVE_NOT_FOUND", status: 404 },
  CANNOT_SAVE_OWN_ROUTE: { code: "CANNOT_SAVE_OWN_ROUTE", status: 400 },
};

export const Success = {
  USER_CREATED: { code: "USER_CREATED", status: 201 },
  USER_LOGGED_IN: { code: "USER_LOGGED_IN", status: 200 },
  USER_LOGGED_OUT: { code: "USER_LOGGED_OUT", status: 200 },
  REFRESH_TOKEN_CREATED: { code: "REFRESH_TOKEN_CREATED", status: 200 },

  USER_FETCHED: { code: "USER_FETCHED", status: 200 },
  USER_UPDATED: { code: "USER_UPDATED", status: 200 },
  PASSWORD_SET: { code: "PASSWORD_SET", status: 200 },
  PASSWORD_CHANGED: { code: "PASSWORD_CHANGED", status: 200 },

  // Social
  USERS_FETCHED: { code: "USERS_FETCHED", status: 200 },
  NOW_FOLLOWING: { code: "NOW_FOLLOWING", status: 201 },
  FOLLOW_REQUEST_SENT: { code: "FOLLOW_REQUEST_SENT", status: 201 },
  FOLLOW_ACCEPTED: { code: "FOLLOW_ACCEPTED", status: 200 },
  FOLLOW_REJECTED: { code: "FOLLOW_REJECTED", status: 200 },
  FOLLOW_CANCELLED: { code: "FOLLOW_CANCELLED", status: 200 },
  UNFOLLOWED: { code: "UNFOLLOWED", status: 200 },
  FOLLOWER_REMOVED: { code: "FOLLOWER_REMOVED", status: 200 },
  FOLLOWERS_FETCHED: { code: "FOLLOWERS_FETCHED", status: 200 },
  FOLLOWING_FETCHED: { code: "FOLLOWING_FETCHED", status: 200 },
  FOLLOW_REQUESTS_FETCHED: { code: "FOLLOW_REQUESTS_FETCHED", status: 200 },
  PROFILE_FETCHED: { code: "PROFILE_FETCHED", status: 200 },

  // Routes
  ROUTE_GENERATED: { code: "ROUTE_GENERATED", status: 200 },
  ROUTE_SAVED: { code: "ROUTE_SAVED", status: 201 },
  ROUTE_DELETED: { code: "ROUTE_DELETED", status: 200 },
  ROUTE_UPDATED: { code: "ROUTE_UPDATED", status: 200 },
  ROUTES_FETCHED: { code: "ROUTES_FETCHED", status: 200 },
  ROUTE_FETCHED: { code: "ROUTE_FETCHED", status: 200 },
  DISCOVER_FETCHED: { code: "DISCOVER_FETCHED", status: 200 },
  ROUTE_SAVED_TO_LIST: { code: "ROUTE_SAVED_TO_LIST", status: 201 },
  ROUTE_UNSAVED_FROM_LIST: { code: "ROUTE_UNSAVED_FROM_LIST", status: 200 },
};

export const sendError = (res, error, details = {}) => {
  const body = {
    status: "error",
    code: error.code,
    ...details,
  };
  // Include message if present in either the error object or details
  if (error.message) body.message = error.message;
  return res.status(error.status).json(body);
};

export const sendSuccess = (res, success, data = {}) => {
  return res.status(success.status).json({
    status: "success",
    code: success.code,
    data,
  });
};

// ─── Server-Sent Events helper ───────────────────────────────────────────────
//
// Opens an SSE response and returns an `emit(event, data)` function that
// writes a named event with a JSON payload. The X-Accel-Buffering header
// disables proxy buffering so events are flushed immediately instead of
// arriving in one blob at the end.
export const setupSSE = (res) => {
  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  return (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
};

// Typed error for pipeline functions that want to surface a specific
// Errors.* definition + message without owning the response object.
export class PipelineError extends Error {
  constructor(errorDef, message) {
    super(message ?? errorDef.code);
    this.errorDef = errorDef;
  }
}
