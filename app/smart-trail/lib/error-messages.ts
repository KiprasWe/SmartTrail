/** Extract a human-readable message from an unknown catch value. */
export function getErrMessage(err: unknown, fallback = "Unknown error"): string {
  if (typeof err !== "object" || err === null) return fallback;
  // Axios-style: err.response.data.code (our API error codes)
  const axiosCode = (err as { response?: { data?: { code?: string } } }).response?.data?.code;
  if (typeof axiosCode === "string") return axiosCode;
  // Standard Error
  const msg = (err as { message?: string }).message;
  if (typeof msg === "string") return msg;
  return fallback;
}

export const errorMessages: Record<string, Record<string, string>> = {
  en: {
    USER_EMAIL_EXISTS: "An account with this email already exists.",
    USER_USERNAME_EXISTS: "This username is already taken.",
    PASSWORDS_DO_NOT_MATCH: "Passwords do not match.",
    PASSWORD_TOO_SHORT: "Password must be at least 8 characters.",
    PASSWORD_NO_NUMBER: "Password must contain at least one number.",
    PASSWORD_ALREADY_SET: "A password is already set for this account.",
    INVALID_LOGIN: "Invalid email or password.",
    NO_ID_TOKEN: "Google sign-in failed. Please try again.",
    ID_TOKEN_INVALID: "Google authentication failed.",
    NO_REFRESH_TOKEN: "Session expired. Please sign in again.",
    INVALID_REFRESH_TOKEN: "Session expired. Please sign in again.",
    REFRESH_TOKEN_EXPIRED: "Session expired. Please sign in again.",
    INVALID_REQUEST: "Invalid request. Please check your input.",
    INTERNAL_SERVER_ERROR: "Something went wrong. Please try again later.",
    UNKNOWN_ERROR: "An unexpected error occurred.",
  },
  lt: {
    USER_EMAIL_EXISTS: "Paskyra su šiuo el. paštu jau egzistuoja.",
    USER_USERNAME_EXISTS: "Šis vartotojo vardas jau užimtas.",
    PASSWORDS_DO_NOT_MATCH: "Slaptažodžiai nesutampa.",
    PASSWORD_TOO_SHORT: "Slaptažodis turi būti bent 8 simbolių.",
    PASSWORD_NO_NUMBER: "Slaptažodis turi turėti bent vieną skaičių.",
    PASSWORD_ALREADY_SET: "Šiai paskyrai slaptažodis jau nustatytas.",
    INVALID_LOGIN: "Neteisingas el. paštas arba slaptažodis.",
    NO_ID_TOKEN: "Google prisijungimas nepavyko. Bandykite dar kartą.",
    ID_TOKEN_INVALID: "Google autentifikacija nepavyko.",
    NO_REFRESH_TOKEN: "Sesija pasibaigė. Prisijunkite iš naujo.",
    INVALID_REFRESH_TOKEN: "Sesija pasibaigė. Prisijunkite iš naujo.",
    REFRESH_TOKEN_EXPIRED: "Sesija pasibaigė. Prisijunkite iš naujo.",
    INVALID_REQUEST: "Netinkama užklausa. Patikrinkite įvestus duomenis.",
    INTERNAL_SERVER_ERROR: "Įvyko klaida. Bandykite vėliau.",
    UNKNOWN_ERROR: "Įvyko nenumatyta klaida.",
  },
};
