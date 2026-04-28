export const PROFILE_CONFIGS = {
  "foot-walking": {
    label: "Walking",
    orsProfile: "foot-walking",
    options: {
      avoid_features: ["ferries", "tunnels"],
    },
  },
  "foot-hiking": {
    label: "Hiking",
    orsProfile: "foot-hiking",
    options: {
      avoid_features: ["ferries"],
    },
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
    // ORS has no native running profile; foot-walking base speed is ~5 km/h.
    // speedFactor scales duration_s down to approximate a ~10 km/h running pace.
    speedFactor: 0.5,
    options: {
      avoid_features: ["ferries", "tunnels", "highways"],
    },
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
    options: {
      avoid_features: ["highways"],
    },
    profileParams: {
      weightings: {
        steepness_difficulty: 1,
      },
    },
    preference: "recommended",
  },
  "cycling-road": {
    label: "Road Cycling",
    orsProfile: "cycling-road",
    options: {
      avoid_features: ["ferries", "steps", "unpavedroads"],
    },
    profileParams: {
      weightings: {
        green: 0.3,
      },
    },
  },
  "cycling-mountain": {
    label: "Mountain Biking",
    orsProfile: "cycling-mountain",
    options: {
      avoid_features: ["ferries", "steps"],
    },
    profileParams: {
      weightings: {
        green: 1.0,
      },
    },
  },
};
