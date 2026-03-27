// store/route-store.ts
type LatLng = { lat: number; lng: number };

export type RouteStep = {
  distance: number;
  duration: number;
  type: number;
  instruction: string;
  name: string;
  way_points: [number, number];
  exit_number?: number;
};

export type RouteSegment = {
  distance: number;
  duration: number;
  steps: RouteStep[];
};

export type OrsRoute = {
  summary: {
    distance: number; // metres
    duration: number; // seconds
  };
  segments: RouteSegment[];
  bbox: [number, number, number, number];
  /** ORS encoded polyline string */
  geometry: string;
  way_points: [number, number];
};

export type OrsRouteCollection = {
  bbox: [number, number, number, number];
  routes: OrsRoute[];
  metadata: {
    attribution: string;
    service: string;
    timestamp: number;
    query: {
      coordinates: [number, number][];
      profile: string;
      profileName: string;
      format: string;
    };
    engine: {
      version: string;
      build_date: string;
      graph_date: string;
      osm_date: string;
    };
  };
};

export type AIPlanWaypoint = {
  name: string;
  lat: number;
  lng: number;
  description: string;
};

export type AIPlan = {
  title: string;
  description: string;
  start: AIPlanWaypoint;
  waypoints: AIPlanWaypoint[];
  end: AIPlanWaypoint;
};

export type RoutePayload = {
  mode: "a_to_b" | "round_trip" | "ai_route";
  route: OrsRouteCollection;
  start: LatLng;
  end?: LatLng;
  plan?: AIPlan;
};

let _payload: RoutePayload | null = null;

export const routeStore = {
  set: (p: RoutePayload) => {
    _payload = p;
  },
  get: (): RoutePayload | null => _payload,
  clear: () => {
    _payload = null;
  },
};
