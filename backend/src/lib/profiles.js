export function calcDuration(distance_km, ors_duration_s, profileConfig) {
  if (profileConfig.runSpeedKmh) {
    return Math.round((distance_km / profileConfig.runSpeedKmh) * 3600);
  }
  return Math.round(ors_duration_s * (profileConfig.speedFactor ?? 1));
}

export const PROFILE_CONFIGS = {
  "foot-walking": {
    label: "Walking",
    orsProfile: "foot-walking",
  },
  "foot-hiking": {
    label: "Hiking",
    orsProfile: "foot-hiking",
    profileParams: {
      weightings: {
        green: 0.8,
        quiet: 0.5,
      },
    },
  },
  running: {
    label: "Running",
    orsProfile: "foot-walking",
    runSpeedKmh: 9,
    profileParams: {
      weightings: {
        quiet: 1.0,
        green: 0.6,
      },
    },
  },
  "cycling-regular": {
    label: "Cycling",
    orsProfile: "cycling-regular",
    profileParams: {
      weightings: {
        steepness_difficulty: 1,
      },
    },
    preference: "recommended",
  },
};
