import i18n from "@/lib/i18n";

export const errorMessages: Record<string, Record<string, string>> = {
  en: {
    // Auth
    NOT_AUTHORIZED: "Not authorized. Please sign in.",
    USER_NOT_FOUND: "Account not found. Please sign in again.",
    INVALID_LOGIN: "Invalid email or password.",
    NO_ID_TOKEN: "Google sign-in failed. Please try again.",
    ID_TOKEN_INVALID: "Google authentication failed.",
    // Session
    NO_REFRESH_TOKEN: "Session expired. Please sign in again.",
    INVALID_REFRESH_TOKEN: "Session expired. Please sign in again.",
    REFRESH_TOKEN_EXPIRED: "Session expired. Please sign in again.",
    // Account
    USER_EMAIL_EXISTS: "An account with this email already exists.",
    USER_USERNAME_EXISTS: "This username is already taken.",
    PASSWORDS_DO_NOT_MATCH: "Passwords do not match.",
    PASSWORD_TOO_SHORT: "Password must be at least 8 characters.",
    PASSWORD_NO_NUMBER: "Password must contain at least one number.",
    PASSWORD_ALREADY_SET: "A password is already set for this account.",
    NO_PASSWORD_SET: "No password is set for this account.",
    INVALID_CURRENT_PASSWORD: "Current password is incorrect.",
    // Validation
    INVALID_REQUEST: "Invalid request. Please check your input.",
    BAD_REQUEST: "Invalid request. Please check your input.",
    // Routes
    ROUTE_NOT_FOUND: "Route not found.",
    ROUTE_ACCESS_DENIED: "You don't have access to this route.",
    // External services
    EXTERNAL_SERVICE_ERROR: "Route service is unavailable. Please try again.",
    AI_GENERATION_FAILED: "AI route generation failed. Please try again.",
    // Server
    INTERNAL_SERVER_ERROR: "Something went wrong. Please try again later.",
    // Network (injected by Axios interceptor)
    NETWORK_ERROR: "No internet connection or server is unreachable.",
    GATEWAY_TIMEOUT: "Server took too long to respond. Please try again.",
    // Fallback
    UNKNOWN_ERROR: "An unexpected error occurred.",
  },
  lt: {
    // Auth
    NOT_AUTHORIZED: "Nesate prisijungęs. Prisijunkite.",
    USER_NOT_FOUND: "Paskyra nerasta. Prisijunkite iš naujo.",
    INVALID_LOGIN: "Neteisingas el. paštas arba slaptažodis.",
    NO_ID_TOKEN: "Google prisijungimas nepavyko. Bandykite dar kartą.",
    ID_TOKEN_INVALID: "Google autentifikacija nepavyko.",
    // Session
    NO_REFRESH_TOKEN: "Sesija pasibaigė. Prisijunkite iš naujo.",
    INVALID_REFRESH_TOKEN: "Sesija pasibaigė. Prisijunkite iš naujo.",
    REFRESH_TOKEN_EXPIRED: "Sesija pasibaigė. Prisijunkite iš naujo.",
    // Account
    USER_EMAIL_EXISTS: "Paskyra su šiuo el. paštu jau egzistuoja.",
    USER_USERNAME_EXISTS: "Šis vartotojo vardas jau užimtas.",
    PASSWORDS_DO_NOT_MATCH: "Slaptažodžiai nesutampa.",
    PASSWORD_TOO_SHORT: "Slaptažodis turi būti bent 8 simbolių.",
    PASSWORD_NO_NUMBER: "Slaptažodis turi turėti bent vieną skaičių.",
    PASSWORD_ALREADY_SET: "Šiai paskyrai slaptažodis jau nustatytas.",
    NO_PASSWORD_SET: "Šiai paskyrai slaptažodis nenustatytas.",
    INVALID_CURRENT_PASSWORD: "Dabartinis slaptažodis neteisingas.",
    // Validation
    INVALID_REQUEST: "Netinkama užklausa. Patikrinkite įvestus duomenis.",
    BAD_REQUEST: "Netinkama užklausa. Patikrinkite įvestus duomenis.",
    // Routes
    ROUTE_NOT_FOUND: "Maršrutas nerastas.",
    ROUTE_ACCESS_DENIED: "Neturite prieigos prie šio maršruto.",
    // External services
    EXTERNAL_SERVICE_ERROR: "Maršruto paslauga nepasiekiama. Bandykite dar kartą.",
    AI_GENERATION_FAILED: "AI maršruto generavimas nepavyko. Bandykite dar kartą.",
    // Server
    INTERNAL_SERVER_ERROR: "Įvyko klaida. Bandykite vėliau.",
    // Network (injected by Axios interceptor)
    NETWORK_ERROR: "Nėra interneto ryšio arba serveris nepasiekiamas.",
    GATEWAY_TIMEOUT: "Serveris neatsakė laiku. Bandykite dar kartą.",
    // Fallback
    UNKNOWN_ERROR: "Įvyko nenumatyta klaida.",
  },
};

/** Translate an error code to a human-readable message in the current locale. */
function lookupCode(code: string): string {
  const locale = i18n.locale in errorMessages ? i18n.locale : "en";
  const messages = errorMessages[locale];
  return messages[code] ?? messages.UNKNOWN_ERROR;
}

/**
 * Extract the error code from any caught value and return its translated message.
 * Works outside React components (no hooks needed).
 */
export function resolveErr(err: unknown): string {
  if (typeof err !== "object" || err === null) return lookupCode("UNKNOWN_ERROR");
  const code = (err as { response?: { data?: { code?: string } } }).response?.data?.code;
  if (typeof code === "string") return lookupCode(code);
  return lookupCode("UNKNOWN_ERROR");
}
