/**
 * Expo Router search params may be string | string[] depending on how the URL was built.
 */
export function paramToString(
  value: string | string[] | undefined,
): string | undefined {
  if (value == null) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
