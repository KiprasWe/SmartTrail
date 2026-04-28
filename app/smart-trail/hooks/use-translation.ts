import { useCallback } from "react";
import i18n from "@/lib/i18n";

export function useTranslation() {
  const t = useCallback(
    (key: string, options?: object) => i18n.t(key, options),
    [],
  );

  return { t, locale: i18n.locale };
}
