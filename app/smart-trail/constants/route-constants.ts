export const TRANSPORT = {
  walking: "walking",
  hiking: "hiking",
  running: "running",
  cycling: "cycling",
  mtb: "mtb",
  ebike: "ebike",
} as const;

export type Transport = (typeof TRANSPORT)[keyof typeof TRANSPORT];
