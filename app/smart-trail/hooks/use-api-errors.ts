// lib/useApiError.ts
import { errorMessages } from "@/lib/error-messages";
import { getLocales } from "expo-localization";

export const useApiError = () => {
  const languageCode = getLocales()[0].languageCode;
  const locale = languageCode === "lt" ? "lt" : "en";

  const resolve = (err: any): string => {
    const code = err?.response?.data?.code as string | undefined;
    const messages = errorMessages[locale];
    return messages[code ?? ""] ?? messages.UNKNOWN_ERROR;
  };

  return { resolve };
};
