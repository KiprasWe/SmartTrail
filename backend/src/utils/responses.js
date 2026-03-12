export const Errors = {
  USER_EMAIL_EXISTS: { code: "USER_EMAIL_EXISTS", status: 400 },
  USER_USERNAME_EXISTS: { code: "USER_USERNAME_EXISTS", status: 400 },
  PASSWORDS_DO_NOT_MATCH: { code: "PASSWORDS_DO_NOT_MATCH", status: 400 },
  PASSWORD_TOO_SHORT: { code: "PASSWORD_TOO_SHORT", status: 400 },
  PASSWORD_NO_NUMBER: { code: "PASSWORD_NO_NUMBER", status: 400 },
  PASSWORD_ALREADY_SET: { code: "PASSWORD_ALREADY_SET", status: 400 },
  INVALID_LOGIN: { code: "INVALID_LOGIN", status: 401 },
  NO_ID_TOKEN: { code: "NO_ID_TOKEN", status: 400 },
  ID_TOKEN_INVALID: { code: "ID_TOKEN_INVALID", status: 401 },
  NO_REFRESH_TOKEN: { code: "NO_REFRESH_TOKEN", status: 400 },
  INVALID_REFRESH_TOKEN: { code: "INVALID_REFRESH_TOKEN", status: 401 },
  REFRESH_TOKEN_EXPIRED: { code: "REFRESH_TOKEN_EXPIRED", status: 401 },

  INVALID_REQUEST: { code: "INVALID_REQUEST", status: 400 },

  INTERNAL_SERVER_ERROR: { code: "INTERNAL_SERVER_ERROR", status: 500 },
};

export const Success = {
  USER_CREATED: { code: "USER_CREATED", status: 201 },
  USER_LOGGED_IN: { code: "USER_LOGGED_IN", status: 200 },
  USER_LOGGED_OUT: { code: "USER_LOGGED_OUT", status: 200 },
  REFRESH_TOKEN_CREATED: { code: "REFRESH_TOKEN_CREATED", status: 200 },

  USER_FETCHED: { code: "USER_FETCHED", status: 200 },
  USER_UPDATED: { code: "USER_UPDATED", status: 200 },
  PASSWORD_SET: { code: "PASSWORD_SET", status: 200 },
};

export const sendError = (res, error, details = {}) => {
  return res.status(error.status).json({
    status: "error",
    code: error.code,
    ...details,
  });
};

export const sendSuccess = (res, success, data = {}) => {
  return res.status(success.status).json({
    status: "success",
    code: success.code,
    data,
  });
};
