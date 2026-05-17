export const TIMEOUT_ROUTING_MS = 30_000;
export const NOMINATIM_TIMEOUT_MS = 12_000;

export const ORS_POI_CHUNK_SIZE = 40;
export const ORS_POI_MAX_GROUPS_PER_REQ = 5;
export const ORS_MATRIX_BATCH = 50;
export const ORS_MAX_RESULTS = 100;

export const ORS_WAYPOINT_CAP = 20;

export const DISTANCE_TOLERANCE = 0.07;
export const MAX_SCALE_PASSES = 6;
export const SCALE_DAMPING = 0.8;
export const MAX_TAIL_CLEAN_PASSES = 5;
export const TAIL_SIZE_THRESHOLD = 0.2;

export const HELD_KARP_LIMIT = 9;

export const SPLICE_BUFFER_M = 200;
export const UNSPLICE_DIST_THRESHOLD_M = 300;

// Option C — folding curated essentials into an already-routed AI loop.
// An essential is spliced in only if its detour cost is under the per-POI
// cap; splicing stops once cumulative added length exceeds the budget
// (fraction of requested distance) or the count cap is hit (bounds ORS
// calls — each splice = 2 directions requests).
export const AI_SPLICE_MAX_DETOUR_KM = 2.5;
export const AI_SPLICE_MAX_COUNT = 8;
// Total detour budget = clamp(FRACTION * requested, FLOOR_KM, MAX_FRACTION
// * requested). The floor stops short routes from being starved (20% of a
// 10km loop is only 2km — one detour eats it); the ceiling stops tiny
// routes from ballooning. Essentials are spliced importance-first so the
// marquee stops get first claim on the budget.
export const AI_SPLICE_BUDGET_FRACTION = 0.25;
export const AI_SPLICE_BUDGET_FLOOR_KM = 3.5;
export const AI_SPLICE_BUDGET_MAX_FRACTION = 0.6;
// Best-effort minimum: the top importance-first essentials are spliced in
// even if they push past the budget, so good routes always get a few real
// stops. The per-POI detour cap still applies, so worst-case overage is
// bounded (~MIN_STOPS * MAX_DETOUR_KM); the budget only starts rejecting
// stops once this minimum is met.
export const AI_SPLICE_MIN_STOPS = 3;
