import { getLocales } from "expo-localization";
import { I18n } from "i18n-js";

import en from "../locales/en.json";
import lt from "../locales/lt.json";

const i18n = new I18n({
  en,
  lt,
});

i18n.locale = getLocales()?.[0]?.languageCode ?? "en";
i18n.enableFallback = true;
i18n.defaultLocale = "en";

/**
 * Translate a key. Plain function — not a hook — because we don't currently
 * support runtime locale switching. If we ever do, swap call sites for a
 * proper hook that subscribes to locale changes.
 */
export const t = (key: string, options?: object): string =>
  i18n.t(key, options);

export default i18n;
