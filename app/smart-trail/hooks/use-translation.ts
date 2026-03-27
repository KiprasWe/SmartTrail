import { useState, useCallback } from "react";
import i18n from "../lib/i18n";

export function useTranslation() {
  const [locale, setLocale] = useState(i18n.locale);

  const changeLocale = useCallback((newLocale: string) => {
    i18n.locale = newLocale;
    setLocale(newLocale);
  }, []);

  const t = useCallback(
    (key: string, options?: object) => i18n.t(key, options),
    [locale],
  );

  return { t, locale, changeLocale };
}
