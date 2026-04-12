// lib/profiles.js — transport profile configuration
//
// Keyed by the profile string the client sends.
// orsProfile — used by loop/AI routing (ORS).
// valhalla   — used by A-to-B routing; costing + base options (use_hills overridden per call).

export const PROFILE_CONFIGS = {
  "foot-walking": {
    label: "Walking",
    orsProfile: "foot-walking",
    valhalla: { costing: "pedestrian", options: { use_hills: 0.5 } },
  },
  "foot-hiking": {
    label: "Hiking",
    orsProfile: "foot-hiking",
    valhalla: {
      costing: "pedestrian",
      options: { use_hills: 0.5, use_trails: 1.0 },
    },
  },
  running: {
    label: "Running",
    orsProfile: "foot-walking",
    valhalla: { costing: "pedestrian", options: { use_hills: 0.5 } },
  },
  "cycling-regular": {
    label: "Cycling",
    orsProfile: "cycling-regular",
    valhalla: {
      costing: "bicycle",
      options: { bicycle_type: "Hybrid", use_roads: 0.1, use_hills: 0.5 },
    },
  },
  "cycling-road": {
    label: "Road Cycling",
    orsProfile: "cycling-road",
    valhalla: {
      costing: "bicycle",
      options: { bicycle_type: "Road", use_roads: 0.8, use_hills: 0.5 },
    },
  },
  "cycling-mountain": {
    label: "Mountain Biking",
    orsProfile: "cycling-mountain",
    valhalla: {
      costing: "bicycle",
      options: {
        bicycle_type: "Mountain",
        use_roads: 0.0,
        use_trails: 1.0,
        use_hills: 0.5,
      },
    },
  },
  "cycling-electric": {
    label: "E-Bike",
    orsProfile: "cycling-electric",
    valhalla: {
      costing: "bicycle",
      options: { bicycle_type: "Hybrid", use_roads: 0.2, use_hills: 0.5 },
    },
  },
};
