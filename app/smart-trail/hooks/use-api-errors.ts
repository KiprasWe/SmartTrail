import { errorMessages } from "@/lib/error-messages";
import i18n from "@/lib/i18n";

export const useApiError = () => {
  const resolve = (err: unknown): string => {
    const code =
      typeof err === "object" && err !== null
        ? (err as { response?: { data?: { code?: string } } }).response?.data
            ?.code
        : undefined;
    const lang = i18n.locale in errorMessages ? i18n.locale : "en";
    const messages = errorMessages[lang];
    return messages[code ?? ""] ?? messages.UNKNOWN_ERROR;
  };

  return { resolve };
};
