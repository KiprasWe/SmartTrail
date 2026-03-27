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

export default i18n;
