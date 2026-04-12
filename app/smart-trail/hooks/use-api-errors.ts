import { errorMessages } from "@/lib/error-messages";
import { getLocales } from "expo-localization";

export const useApiError = () => {
  const languageCode = getLocales()[0].languageCode;
  const locale = languageCode === "lt" ? "lt" : "en";

  const resolve = (err: unknown): string => {
    const code =
      typeof err === "object" && err !== null
        ? (err as { response?: { data?: { code?: string } } }).response?.data?.code
        : undefined;
    const messages = errorMessages[locale];
    return messages[code ?? ""] ?? messages.UNKNOWN_ERROR;
  };

  return { resolve };
};
