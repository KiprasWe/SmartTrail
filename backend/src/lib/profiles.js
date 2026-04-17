// lib/profiles.js — transport profile configuration
//
// Keyed by the profile string the client sends.
// orsProfile — used by all routing (ORS).

export const PROFILE_CONFIGS = {
  "foot-walking": {
    label: "Walking",
    orsProfile: "foot-walking",
  },
  "foot-hiking": {
    label: "Hiking",
    orsProfile: "foot-hiking",
  },
  running: {
    label: "Running",
    orsProfile: "foot-walking",
  },
  "cycling-regular": {
    label: "Cycling",
    orsProfile: "cycling-regular",
  },
  "cycling-road": {
    label: "Road Cycling",
    orsProfile: "cycling-road",
  },
  "cycling-mountain": {
    label: "Mountain Biking",
    orsProfile: "cycling-mountain",
  },
  "cycling-electric": {
    label: "E-Bike",
    orsProfile: "cycling-electric",
  },
};
