# SmartTrail Backend — Logic Audit & Simplification Plan

This document focuses **only on code logic, simplification, and refactor opportunities**. Infrastructure concerns (rate limiting, Redis, helmet, queues, deployment) are intentionally excluded.

---

## 1. Executive Summary

The backend's logic is concentrated in three places:

1. **`src/lib/ai/pipeline.js` (766 lines)** — orchestrates Gemini, ORS, Overpass and Nominatim through 6 stages with significant inline logic.
2. **`src/controllers/routeGenerationController.js` (636 lines)** — mixes HTTP parsing, ORS calls, POI scoring, reachability, and response shaping.
3. **`src/lib/places.js` (1035 lines)** — a god module containing OSM type maps, Overpass, ORS POI search, Nominatim geocoding, fuzzy matching, and named-POI resolution.

These three files contain ~85% of the system's complexity. The auth + CRUD layers are clean and don't need much work.

The biggest wins, ordered by ratio of impact to effort:

| # | Change | Where | Effort |
|---|---|---|---|
| 1 | Combine 3 Gemini calls (`extractSpatialAreas`, `detectMode`, `decomposeIntent`) into one planning call | `lib/ai/pipeline.js`, `lib/ai/classify.js`, `lib/ai/spatial.js` | Medium |
| 2 | Stop calling `detectMode` twice in named/mixed mode | `lib/ai/pipeline.js:228, 237` | Trivial |
| 3 | Merge two POI reachability implementations into one | `lib/ai/reachability.js` + `controllers/routeGenerationController.js` | Low |
| 4 | Split `places.js` by responsibility | `lib/places.js` | Medium |
| 5 | Extract pipeline stages into pure functions over a single `state` object | `lib/ai/pipeline.js` | Medium |
| 6 | Extract POI scoring + reachability + insertion math out of `routeGenerationController` | `controllers/routeGenerationController.js` | Low |
| 7 | Skip `extractSpatialAreas` when the text obviously has no spatial markers | `lib/ai/spatial.js` | Trivial |
| 8 | Validate every Gemini output with Zod (membership + shape) before consumption | all `lib/ai/*` | Low |
| 9 | Slim `authMiddleware` — drop DB hit, drop dead cookie branch | `middleware/authMiddleware.js` | Trivial |
| 10 | Replace ad-hoc `.catch(() => [])` with explicit `degradations` collection | `lib/ai/pipeline.js` | Low |
| 11 | Replace duplicated "find by id then check ownership" with a `loadOwnedRoute` helper | `controllers/savedRoutesController.js` | Trivial |
| 12 | Centralise magic numbers (radii, thresholds, snap distances) into one config file | scattered | Trivial |

---

## 2. AI Pipeline (`lib/ai/pipeline.js`)

### 2.1 `detectMode` is called twice — fix first

```js
// pipeline.js:228 — first call (empty pool, just to decide if we need discovery)
const preCheck = await detectMode(preferences, genai, GEMINI_MODEL, []);
const needsDiscovery = preCheck.mode === "named" || preCheck.mode === "mixed";

const discoveredPois = await discoverAllPois({ start, end, hasEnd, zones });

// pipeline.js:237 — second call (real pool, for name matching)
const { mode, namedPlaces, hasCategories } = needsDiscovery
  ? await detectMode(preferences, genai, GEMINI_MODEL, discoveredPois)
  : preCheck;
```

`preCheck` is thrown away whenever discovery runs. Two Gemini calls when one would do.

**Fix:** decide whether discovery is needed via a cheap heuristic (regex for capitalised words, accented characters, or quoted strings inside `preferences`), then call `detectMode` exactly once with the right pool.

```js
function probablyHasNamedPlaces(text) {
  if (!text) return false;
  // capitalised non-stop word, accented letters, or quoted span
  return /[A-ZĄČĘĖĮŠŲŪŽ][a-ząčęėįšųūž]{2,}/.test(text) || /["„""'']/.test(text);
}

const needsDiscovery = probablyHasNamedPlaces(preferences);
const discoveredPois = needsDiscovery
  ? await discoverAllPois({ start, end, hasEnd, zones })
  : [];
const { mode, namedPlaces, hasCategories } = preferences?.trim()
  ? await detectMode(preferences, genai, GEMINI_MODEL, discoveredPois)
  : { mode: "category", namedPlaces: [], hasCategories: true };
```

When `preferences` is empty, skip Gemini entirely.

### 2.2 Combine the three Gemini "understanding" calls into one

The pipeline currently makes three separate Gemini calls before it can build a search plan:

| Call | File | Returns |
|---|---|---|
| `extractSpatialAreas` | `spatial.js` | `[{label, geocode_hint, direction}]` |
| `detectMode` | `classify.js` | `{mode, namedPlaces, hasCategories}` |
| `decomposeIntent` | `classify.js` | `[{theme, places_type, location_scope, ...}]` |

All three operate on the same input (`preferences`) and the same context (`area`, `placeStart`, `placeEnd`, `distanceKm`). The model has to re-read the same text three times. Combine them into a single planning call:

```js
const PlanSchema = z.object({
  mode: z.enum(["category", "named", "mixed"]),
  named_places: z.array(z.string()).max(8),
  has_categories: z.boolean(),
  spatial_areas: z.array(z.object({
    label: z.string(),
    geocode_hint: z.string(),
    direction: z.enum(["", "north", "northeast", "east", ...]),
  })).max(3),
  intents: z.array(IntentSchema).max(6),
});

const plan = await llm.generateJson({
  systemInstruction: PLAN_SYSTEM_RULES,    // static, can be cached
  user: buildPlanPrompt(params, discoveredPois),
  schema: PlanSchema,
});
```

Then the pipeline becomes:

```
preferences → discover (if heuristic suggests) → ONE plan call → search/curate
```

Total Gemini calls per request drops from 4–5 to 1–2 (plan + curate). Latency drops by 3–6 s on warm cases.

### 2.3 Replace the inline 12-step orchestration with stage functions over a `state` object

`runAiPipeline` is a 700-line linear procedure with inline branches like:

```js
const reachabilityPool =
  skeletonCoords && rawPool.length > 12
    ? await filterReachablePois(rawPool, skeletonCoords, orsProfile, reachabilityDistKm).catch(
        (err) => { console.warn(...); return rawPool; },
      )
    : rawPool;
```

Each stage is independently testable but the orchestrator hard-codes the wiring. Refactor to:

```js
// stages/01-skeleton.js
export async function skeletonStage(state, ctx) {
  const { skeletonCoords, skeletonDistanceM } = await buildSkeleton(state, ctx);
  return { ...state, skeletonCoords, skeletonDistanceM };
}

// stages/02-discover.js
export async function discoverStage(state, ctx) {
  // ...
  return { ...state, zones, discoveredPois };
}

// pipeline.js
export async function runAiPipeline(params, { onStage } = {}) {
  let state = initialState(params);
  const stages = [skeletonStage, discoverStage, planStage, searchStage, curateStage, routeStage];

  for (const stage of stages) {
    onStage(stage.name);
    state = await stage(state, ctx);
  }
  return finalize(state);
}
```

Benefits:
- The orchestrator drops from 700+ lines to ~50.
- Stage tests don't need to mock the entire pipeline — they take state in, return state out.
- Stage retry/skip/replace becomes trivial.
- The "stage event" stream becomes uniform — no special cases for `routing_skeleton`, `ai_pois`, `enriching`, `curating`, `routing` (which is the current ad-hoc set).

### 2.4 Replace `.catch(() => [])` with a `degradations[]` channel

The pipeline silently swallows failures across many sites:

```js
// pipeline.js:212-218
const [placeStart, placeEnd, rawSpatialAreas] = await Promise.all([
  reverseGeocodePlaceName(start, lang).catch(() => null),
  hasEnd ? reverseGeocodePlaceName(end, lang).catch(() => null) : Promise.resolve(null),
  extractSpatialAreas(...).catch(() => []),
]);

// pipeline.js:307
const intents = mode !== "named"
  ? await decomposeIntent({ ... }).catch(() => [])
  : [];
```

When Overpass goes down or Gemini quota is exhausted, the user gets an empty/degraded route with **no explanation**. Replace with explicit tracking:

```js
const degradations = [];

const intents = mode !== "named"
  ? await decomposeIntent({...}).catch(err => {
      degradations.push({ stage: "decomposeIntent", reason: err.message });
      return [];
    })
  : [];

// at the end
return { ..., degradations };
```

The client (and you) can now see *why* the result was thin.

### 2.5 The corridor-filter / reachability-filter / specific-area logic is duplicated three times

In `pipeline.js` there are three branches (`mode === "category"`, `"named"`, `"mixed"`) with very similar pool-assembly logic:

```js
// category branch
const filteredDiscovered = skeletonCoords ? polylineCorridorFilter(...) : discoveredPois;
const rawPool = dedupPois([...regularCategoryPois, ...filteredDiscovered]);
const reachabilityPool = skeletonCoords && rawPool.length > 12
  ? await filterReachablePois(...).catch(...) : rawPool;
const allSpecificPois = dedupPois([...specificAreaPois, ...taggedSpatialPois]);
enrichedPool = dedupPois([...allSpecificPois, ...reachabilityPool]);

// mixed branch (almost the same, with namedPois added)
const filteredCategoryPois = skeletonCoords ? polylineCorridorFilter(...) : categoryPois;
const mixedPool = dedupPois([...namedPois, ...filteredCategoryPois, ...taggedSpatialPois]);
const namedIds = new Set(namedPois.map(p => p.place_id));
const reachabilityChecked = await filterReachablePois(
  mixedPool.filter(p => !namedIds.has(p.place_id)), ...
).catch(...);
enrichedPool = dedupPois([...namedPois, ...reachabilityChecked]);
```

Extract a single function `assemblePool({ committed, candidates, bypasses, skeletonCoords, orsProfile, distanceKm })`:

```js
async function assemblePool({ committed, candidates, bypasses, skeletonCoords, orsProfile, distanceKm }) {
  // 1. corridor filter on candidates only (committed + bypasses skip it)
  const filtered = skeletonCoords ? polylineCorridorFilter(candidates, skeletonCoords) : candidates;

  // 2. reachability on the filtered candidates only
  const reachable = (skeletonCoords && filtered.length > 12)
    ? await filterReachablePois(filtered, skeletonCoords, orsProfile, distanceKm).catch(() => filtered)
    : filtered;

  // 3. dedup the union
  return dedupPois([...committed, ...bypasses, ...reachable]);
}
```

Then each mode is one line:

```js
if (mode === "named") {
  enrichedPool = namedPois;
} else {
  enrichedPool = await assemblePool({
    committed: namedPois,
    candidates: mode === "category"
      ? [...regularCategoryPois, ...discoveredPois]
      : categoryPois,
    bypasses: [...specificAreaPois, ...taggedSpatialPois],
    skeletonCoords,
    orsProfile,
    distanceKm: skeletonDistanceM > 0 ? skeletonDistanceM / 1000 : distanceKm,
  });
}
```

Three branches collapse to two.

### 2.6 `routePositions` building is duplicated logic

`pipeline.js:514-534` builds a `routePositions` Map by iterating the skeleton and finding the nearest point for each POI. It already exists conceptually inside `polylineCorridorFilter` and `filterPoisByReachability` (both compute distance-from-skeleton). Extract:

```js
// domain/routes/poi-projection.js
export function projectPoisOntoSkeleton(pois, skeletonCoords) {
  const cumul = cumulativeDistances(skeletonCoords);
  const totalM = cumul.at(-1);
  if (!totalM) return new Map();

  const positions = new Map();
  for (const p of pois) {
    const idx = nearestIndex([p.lng, p.lat], skeletonCoords);
    positions.set(p.place_id, cumul[idx] / totalM);
  }
  return positions;
}
```

Reuse in curation, in scoring, and anywhere else that needs "where on the route is this POI".

### 2.7 Sorting + waypoint capping logic is also tangled

```js
// pipeline.js:598-617
const allSorted = hasEnd
  ? sortPoisAlongLine(finalPois, start, end)
  : sortPoisAroundLoop(finalPois, start);
const poiFeatures = allSorted.map(enrichedPoiToFeature);
const essentialOrdered = allSorted.filter((p) => p.essential);
const userWaypointsInEssential = essentialOrdered.filter((p) => p._isUserWaypoint);
const aiEssentialOrdered = essentialOrdered.filter((p) => !p._isUserWaypoint);
const waypointPois = [
  ...userWaypointsInEssential,
  ...aiEssentialOrdered.slice(0, ORS_WAYPOINT_CAP - userWaypointsInEssential.length),
];
```

This is "sort, take essentials, prefer user waypoints, cap at N". Extract:

```js
function selectWaypoints(allSorted, cap) {
  const essential = allSorted.filter(p => p.essential);
  const [userWp, aiWp] = partition(essential, p => p._isUserWaypoint);
  return [...userWp, ...aiWp.slice(0, cap - userWp.length)];
}
```

The big block at 598–656 (city anchor merging, projection sorting, waypoint coords map) becomes a 10-line stage function.

---

## 3. `controllers/routeGenerationController.js`

### 3.1 Two separate POI reachability implementations exist

There are two near-identical implementations:

| File | Function | Used by |
|---|---|---|
| `controllers/routeGenerationController.js:55-135` | `filterPoisByReachability` | `directRouting`, `loopRouting` |
| `lib/ai/reachability.js:15-121` | `filterReachablePois` | `pipeline.js` |

They differ in:
- the AI version skips POIs within 300 m straight-line ("ALWAYS_KEEP_M")
- the controller version uses 50-location caps, the AI version 200-location caps
- the AI version uses `DETOUR_RATIO_MAX = 3.0` and `MAX_ROUTED_M = max(3000, distanceKm * 200)`
- the controller version uses a fixed `BARRIER_MAX_ROUTED_M = 3500`

These are two slightly different policies for the same idea. Consolidate:

```js
// domain/routes/reachability.js
export async function filterReachablePois(pois, skeletonCoords, {
  orsProfile,
  alwaysKeepM = 300,
  detourRatioMax = 3.0,
  maxRoutedM = 3500,
  matrixSourceCount = 10,
  matrixMaxLocations = 50,
} = {}) {
  // single implementation; callers pass policy
}
```

Then both call sites use the same code with different policy objects. ~120 lines deleted.

### 3.2 Inline scoring helpers should be in their own module

`thinForInsertion`, `cheapestInsertionAddedM`, `poiQualityScore`, `rankAndLimitPois` are pure functions defined in the controller. Move to `domain/routes/poi-scoring.js`. The controller becomes 400 lines instead of 636.

### 3.3 The "elevation-pick across N candidates" pattern is duplicated

```js
// directRouting (lines 198-207)
if (elevationPreference === "optimal") {
  const sorted = [...candidates].sort((a, b) => a.ascent_m - b.ascent_m);
  pickedData = sorted[Math.floor(sorted.length / 2)];
} else {
  pickedData = candidates.reduce((best, c) =>
    elevationPreference === "flat"
      ? c.ascent_m < best.ascent_m ? c : best
      : c.ascent_m > best.ascent_m ? c : best,
  );
}

// loopRouting (lines 354-363) — same logic for loop candidates
if (elevationPreference === "optimal") {
  const sorted = [...candidates].sort((a, b) => a.routeData.ascent_m - b.routeData.ascent_m);
  result = sorted[Math.floor(sorted.length / 2)];
} else {
  result = candidates.reduce((best, r) =>
    elevationPreference === "flat"
      ? r.routeData.ascent_m < best.routeData.ascent_m ? r : best
      : r.routeData.ascent_m > best.routeData.ascent_m ? r : best,
  );
}
```

Extract once:

```js
function pickByElevation(candidates, preference, getAscent) {
  if (preference === "optimal") {
    const sorted = [...candidates].sort((a, b) => getAscent(a) - getAscent(b));
    return sorted[Math.floor(sorted.length / 2)];
  }
  const cmp = preference === "flat"
    ? (a, b) => getAscent(a) - getAscent(b)
    : (a, b) => getAscent(b) - getAscent(a);
  return [...candidates].sort(cmp)[0];
}

// callers
pickedData = pickByElevation(candidates, elevationPreference, c => c.ascent_m);
result = pickByElevation(candidates, elevationPreference, r => r.routeData.ascent_m);
```

### 3.4 `addPoiToRoute` does best-leg search inline

The "find which leg to insert the POI into" logic (lines 421–434):

```js
let bestLegIdx = 0;
let bestDetour = Infinity;
for (let i = 0; i < legs.length; i++) {
  const leg = legs[i];
  const detour =
    haversineM(leg.from, poi) + haversineM(poi, leg.to) - haversineM(leg.from, leg.to);
  if (detour < bestDetour) { bestDetour = detour; bestLegIdx = i; }
}
```

This is just the cheapest-insertion algorithm — already implemented as `cheapestInsertionAddedM` in the same file. The two should share one implementation that returns *both* the leg index and the detour cost.

```js
// domain/routes/poi-scoring.js
export function findCheapestInsertion(poi, anchors) {
  let bestIdx = 0, bestCost = Infinity;
  for (let i = 0; i < anchors.length - 1; i++) {
    const cost = haversineM(anchors[i], poi) + haversineM(poi, anchors[i + 1])
               - haversineM(anchors[i], anchors[i + 1]);
    if (cost < bestCost) { bestCost = cost; bestIdx = i; }
  }
  return { index: bestIdx, addedM: Math.max(0, bestCost) };
}
```

### 3.5 Profile validation is repeated in every controller

```js
// directRouting:168
const profileConfig = PROFILE_CONFIGS[profile];
if (!profileConfig)
  return sendError(res, { ...Errors.BAD_REQUEST, message: `Invalid profile: ${profile}` });

// loopRouting:304
const profileConfig = PROFILE_CONFIGS[profile];
if (!profileConfig)
  return sendError(res, { ...Errors.BAD_REQUEST, message: `Invalid profile: ${profile}` });

// addPoiToRoute:418
// aiReroute:523
```

Same 3-line block in 4 places. The profile is already validated by the Zod enum in `routeValidators.js` — if validation passes, the value is one of the enum members, but `PROFILE_CONFIGS` only has 6 entries while the enum allows 7 (`cycling-electric`). Fix the **real** bug — sync the two — and the runtime check becomes unnecessary:

```js
// profiles.js — single source of truth
export const PROFILE_KEYS = [
  "foot-walking", "foot-hiking", "running",
  "cycling-regular", "cycling-road", "cycling-mountain", "cycling-electric",
];
export const PROFILE_CONFIGS = { /* all 7 entries */ };

// validators
import { PROFILE_KEYS } from "../lib/profiles.js";
const profile = z.enum(PROFILE_KEYS);

// controllers — drop the runtime check, validation already guarantees it
const profileConfig = PROFILE_CONFIGS[profile];
```

### 3.6 `buildLoopRoute` and the inline "build response route object" code are similar

Loop builds a route object via `buildLoopRoute`. A→B builds it inline (lines 244–257). `aiReroute` builds it inline (lines 559–574). `aiRouting` (in pipeline) builds it inline (lines 696–712 and 746–763).

Four nearly identical assemblies. Extract:

```js
// domain/routes/route-shape.js
export function toResponseRoute({ label, description, profile, routeData, pois, extras = {} }) {
  return {
    label,
    description,
    profile,
    distance_km: routeData.distance_km,
    duration_s: routeData.duration_s,
    ascent_m: routeData.ascent_m,
    descent_m: routeData.descent_m,
    geometry: { type: "LineString", coordinates: routeData.coords },
    bbox: routeBbox(routeData.coords),
    elevation_profile: routeData.elevArr,
    maneuvers: routeData.maneuvers,
    pois,
    ...extras,
  };
}
```

Saves ~80 lines across 4 sites.

### 3.7 `loopPoiSuggestions` and `rankAndLimitPois` overlap

`loopPoiSuggestions` (lines 584–635) does:

1. Fetch ORS POIs by category → normalise → filter named.
2. Project onto thinned route, score by `quality - addedM/200`.
3. Sort, slice, return.

`rankAndLimitPois` (lines 137–150) does **the same scoring** but for pre-fetched pools. Extract the scoring to one place:

```js
function scorePoi(poi, anchors) {
  const addedM = cheapestInsertionAddedM([poi.lng, poi.lat], anchors);
  return { poi, addedM, score: poiQualityScore(poi) - addedM / 200 };
}

function rankByDetourQuality(pois, anchors) {
  return pois.map(p => scorePoi(p, anchors)).sort((a, b) => b.score - a.score);
}
```

Both call sites become 1–2 lines.

---

## 4. `lib/places.js` (1035 lines)

This file is the largest single file and the hardest to navigate. It mixes:

- OSM tag → internal-type maps (8 large lookup objects)
- Overpass query building + execution (`overpassQuery`, `buildOverpassQuery`, `searchCorridorByType`, `searchAreaByOsmTags`, `discoverAllPois`)
- ORS POI search (`orsPoiSearch`, `orsFeatureToPoi`, `searchORS`, `searchPlacesForAllIntents`)
- Nominatim (`geocodeCity`, `reverseGeocodePlaceName`, `fetchNamedPoiNominatim`)
- Named-POI resolution (`resolveNamedPois`, `resolveOneName`, `fuzzyMatchPoi`, `fetchNamedPoiOverpass`)
- Helpers (`coordsToBbox`, `sampleSkeleton`, `skeletonHaversineM`, `_simpleWordOverlap`, `normalize`)

### 4.1 Split into focused modules

```
lib/places/
  poi-types-map.js         // all 8 lookup tables + osmTagsToPrimaryType
  overpass.js              // overpassQuery + the 3 search variants
  ors-pois.js              // orsPoiSearch + orsFeatureToPoi + searchORS + searchPlacesForAllIntents
  nominatim.js             // geocodeCity + reverseGeocodePlaceName
  named-resolver.js        // resolveNamedPois, fuzzyMatchPoi, fetchNamedPoiOverpass
  utils.js                 // coordsToBbox, sampleSkeleton, normalize
  index.js                 // re-exports the public surface
```

### 4.2 The four lookup tables can collapse into one

`OSM_TOURISM_TO_TYPE`, `OSM_HISTORIC_TO_TYPE`, `OSM_LEISURE_TO_TYPE`, `OSM_AMENITY_TO_TYPE`, `OSM_NATURAL_TO_TYPE`, `OSM_SHOP_TO_TYPE` are six separate objects consumed by one function (`osmTagsToPrimaryType`). They could be one nested object with a uniform shape:

```js
const OSM_TO_TYPE = {
  tourism: { attraction: "tourist_attraction", museum: "museum", artwork: "tourist_attraction", ... },
  historic: { castle: "historical_landmark", ruins: "historical_landmark", ... },
  leisure: { park: "park", nature_reserve: "national_park", ... },
  amenity: { restaurant: "restaurant", cafe: "cafe", ... },
  natural: { peak: "tourist_attraction", waterfall: "tourist_attraction", ... },
  shop: { mall: "shopping_mall", department_store: "shopping_mall" },
};

const OSM_KEY_PRIORITY = ["tourism", "historic", "leisure", "amenity", "natural", "shop"];
const DEFAULT_TYPE_PER_KEY = {
  tourism: "tourist_attraction",
  historic: "historical_landmark",
  leisure: "park",
  amenity: "tourist_attraction",
  natural: "tourist_attraction",
  shop: null,
};

function osmTagsToPrimaryType(tags) {
  for (const key of OSM_KEY_PRIORITY) {
    if (tags[key]) return OSM_TO_TYPE[key]?.[tags[key]] ?? DEFAULT_TYPE_PER_KEY[key];
  }
  return "tourist_attraction";
}
```

Same behaviour, half the boilerplate, easier to extend.

### 4.3 `TYPE_TO_ORS_CATEGORIES` and `ORS_ID_TO_TYPE` are inverses of each other

Both maps are maintained by hand. Adding a new type requires editing both. Derive one from the other:

```js
const TYPE_TO_ORS_CATEGORIES = {
  tourist_attraction: [622, 621, 627, 623],
  historical_landmark: [224, 223, 232, 243, 226, 227, 228, 236, 239, 131],
  // ...
};

const ORS_ID_TO_TYPE = Object.fromEntries(
  Object.entries(TYPE_TO_ORS_CATEGORIES).flatMap(
    ([type, ids]) => ids.map(id => [id, type])
  )
);
```

Single source of truth. Can't drift.

### 4.4 `fetchNamedPoiOverpass` has three nearly identical query branches

Lines 729–826 are three blocks:

1. Exact name match, two paddings (0.15°, 0.5°).
2. Partial regex prefix match, two paddings (0.2°, 0.5°).
3. Nominatim fallback.

Each block builds its own bbox, query, fetch, parse loop. Extract a single `tryOverpassNameSearch(query, bbox)` helper and turn the function into a flat list of attempts:

```js
async function fetchNamedPoiOverpass(name, ctx) {
  const attempts = [
    () => exactNameSearch(name, ctx, 0.15),
    () => exactNameSearch(name, ctx, 0.5),
    () => regexPrefixSearch(name, ctx, 0.2),
    () => regexPrefixSearch(name, ctx, 0.5),
    () => fetchNamedPoiNominatim(name, ctx),
  ];
  for (const attempt of attempts) {
    const result = await attempt().catch(() => null);
    if (result) return result;
  }
  return null;
}
```

Each individual `*Search` function is small and isolated. The overall flow is now a one-look-loop instead of an 100-line nested mess.

### 4.5 `normalize` and `_simpleWordOverlap` and the inline normalisation in `fetchNamedPoiOverpass` are all the same logic

Lines 670–679 (`normalize`), 768–775 (inline), 830–844 (`_simpleWordOverlap`'s `norm`) all do "lowercase + NFD strip + non-alphanumeric → space + collapse whitespace". Different implementations, subtly different behaviours. Pick one, export it, use it everywhere.

```js
// lib/places/utils.js
export function normalizeForMatch(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
```

### 4.6 `fuzzyMatchPoi` uses a brittle scoring ladder

```js
if (normName === normQuery) return poi;             // 100
if (queryWords.every(w => normName.includes(w))) score = 90;
else if (normName.includes(normQuery))             score = 80;
else if (normQuery.includes(normName) && len > 4)  score = 70;
else { /* word-overlap fallback */                 score = 0..60 }
```

Magic 70/80/90 thresholds; `>= 50` cutoff later. This works but is hard to tune. A single normalised word-overlap + token-edit-distance metric (e.g. trigram Jaccard or `fast-levenshtein` over normalised tokens) would be both simpler and more accurate.

---

## 5. `lib/ai/*` smaller files

### 5.1 `spatial.js` — short-circuit on text without spatial markers

`extractSpatialAreas` always calls Gemini when `preferences` is non-empty. Most preferences ("history and food", "scenic", "running route") have zero spatial markers. Pre-filter with a regex:

```js
const SPATIAL_HINT_RE = /\b(north|south|east|west|northern|southern|eastern|western|northeast|northwest|southeast|southwest|old town|new town|riverside|left bank|right bank|hill|district|part|side|center|centre|downtown)\b/i;

if (!SPATIAL_HINT_RE.test(preferences)) return [];
```

Cuts most calls in half with no behavioural change for the cases that matter.

### 5.2 `classify.js` — `normalizeIntents` does too much

Lines 363–399 mix:
- type validation against `ALLOWED_PLACES_TYPES`
- scope validation against a small set
- length truncation
- numeric clamping
- OSM-tag sanitisation (regex-strip-and-slice)

Split into a Zod schema for shape + a separate sanitiser for the OSM-tag strings. The model already returns shape via `responseJsonSchema`; the function's only real job is *sanitising user-influenceable strings*.

```js
const IntentZ = z.object({
  theme: z.string().trim().min(1).max(150),
  places_type: z.string().refine(v => ALLOWED.has(v) || v === "", { message: "bad type" }),
  location_scope: z.enum(["along_route","at_end","at_start","in_area"]).default("along_route"),
  specific_area: z.string().trim().max(100).default(""),
  count: z.coerce.number().int().min(1).max(8).default(3),
  force_via_city: z.string().trim().max(100).default(""),
  osm_tags: z.array(z.object({
    key: z.string().regex(/^[a-z_:-]{1,40}$/i),
    value: z.string().max(40).transform(v => v.replace(/["\\]/g, "")),
  })).max(6).default([]),
});

function normalizeIntents(parsed) {
  if (!Array.isArray(parsed)) return [];
  return parsed.map(i => IntentZ.safeParse(i)).filter(r => r.success).map(r => r.data).slice(0, 6);
}
```

### 5.3 `waypoints.js` — `sortPoisAroundLoop` is a TSP greedy solver

Lines 52–76 are a hand-rolled greedy nearest-neighbour. `loop-tsp.js` already exists and presumably has a real TSP implementation. Either:

- Use `loop-tsp` here (consistent algorithm everywhere), or
- Document why this one needs to differ (it's only for sort-order display, not routing).

Right now they coexist with no shared logic. Pick one.

### 5.4 `curate.js:106-110` — three-bucket position labelling could be data-driven

```js
function positionLabel(fraction) {
  if (fraction < 0.33) return "[ROUTE START]";
  if (fraction < 0.67) return "[MIDROUTE]";
  return "[ROUTE END]";
}
```

Combined with `pipeline.js`'s `routePositions` Map and the `distributionRule` block in `curate.js:152–166`, all three pieces are computing/using the same start/mid/end fractions. Move to one helper:

```js
const ROUTE_BUCKETS = [
  { max: 0.33, label: "[ROUTE START]", key: "start" },
  { max: 0.67, label: "[MIDROUTE]",    key: "mid"   },
  { max: 1.01, label: "[ROUTE END]",   key: "end"   },
];

export function bucketFor(fraction) {
  return ROUTE_BUCKETS.find(b => fraction < b.max);
}
export function bucketize(positions) {
  const counts = { start: 0, mid: 0, end: 0 };
  for (const f of positions.values()) counts[bucketFor(f).key]++;
  return counts;
}
```

Adding a 4th bucket later is a one-line edit.

---

## 6. `controllers/savedRoutesController.js`

### 6.1 The "find then ownership-check" block is repeated 3 times

```js
// getSavedRoute
const route = await prisma.route.findUnique({ where: { id } });
if (!route) return sendError(res, Errors.ROUTE_NOT_FOUND);
if (route.userId !== userId) return sendError(res, Errors.ROUTE_ACCESS_DENIED);

// updateSavedRoute — same 3 lines
// deleteSavedRoute — same 3 lines
```

Replace with one middleware that both fetches and authorises:

```js
// middleware/loadOwnedRoute.js
export const loadOwnedRoute = async (req, res, next) => {
  const route = await prisma.route.findUnique({ where: { id: req.params.id } });
  if (!route) return sendError(res, Errors.ROUTE_NOT_FOUND);
  if (route.userId !== req.user.id) return sendError(res, Errors.ROUTE_ACCESS_DENIED);
  req.route = route;
  next();
};
```

Then:

```js
router.get("/saved/:id", authMiddleware, loadOwnedRoute, getSavedRoute);
router.patch("/saved/:id", authMiddleware, loadOwnedRoute, validate(updateRouteSchema), updateSavedRoute);
router.delete("/saved/:id", authMiddleware, loadOwnedRoute, deleteSavedRoute);
```

Controllers drop the boilerplate:

```js
export const getSavedRoute = (req, res) =>
  sendSuccess(res, Success.ROUTE_FETCHED, { route: req.route });

export const deleteSavedRoute = asyncHandler(async (req, res) => {
  await prisma.route.delete({ where: { id: req.route.id } });
  return sendSuccess(res, Success.ROUTE_DELETED, { id: req.route.id });
});
```

### 6.2 `simplifyForThumbnail` runs on every list call

`listSavedRoutes:64-67` decodes geometry JSON and runs Douglas-Peucker on every result, every request. That's per-row work that's identical run-to-run. Move it to save-time: store a `thumbnail` JSON column populated on `saveRoute` / `updateSavedRoute`. List queries then `select` it as a plain field.

### 6.3 `updateSavedRoute` accepts the entire `req.body` for `data`

```js
const route = await prisma.route.update({ where: { id }, data: req.body });
```

`updateRouteSchema` (`routeValidators.js:114-118`) only allows `title`, `description`, `isFavorite`. The DB doesn't have `isFavorite` (see schema — there is no such column), so this would be ignored or error depending on Prisma settings. Either:

- Add `isFavorite Boolean @default(false)` to the `Route` model, or
- Remove `isFavorite` from `updateRouteSchema` and `saveRouteSchema`.

Right now you have validator fields with no DB backing.

---

## 7. `controllers/authController.js`

### 7.1 `signup` uses two parallel `findUnique` calls

```js
const [emailTaken, usernameTaken] = await Promise.all([
  prisma.user.findUnique({ where: { email } }),
  prisma.user.findUnique({ where: { username } }),
]);
if (emailTaken) return sendError(res, Errors.USER_EMAIL_EXISTS);
if (usernameTaken) return sendError(res, Errors.USER_USERNAME_EXISTS);
```

Two queries instead of one. Use `findFirst`:

```js
const collision = await prisma.user.findFirst({
  where: { OR: [{ email }, { username }] },
  select: { email: true, username: true },
});
if (collision?.email === email)       return sendError(res, Errors.USER_EMAIL_EXISTS);
if (collision?.username === username) return sendError(res, Errors.USER_USERNAME_EXISTS);
```

### 7.2 `googleAuth` has three branches that do similar things

Branch A (existing OAuth link) → tokens + USER_LOGGED_IN
Branch B (existing email, no OAuth) → create OAuth link + tokens + USER_LOGGED_IN
Branch C (new user) → create user + OAuth + tokens + USER_CREATED

Branches A and B both end with the same response:

```js
const tokens = await buildTokenPair(user.id);
return sendSuccess(res, Success.USER_LOGGED_IN, {
  user: buildUserPayload(user),
  ...tokens,
});
```

Pull the post-auth response shape into a helper:

```js
async function respondWithSession(res, user, success = Success.USER_LOGGED_IN) {
  const tokens = await buildTokenPair(user.id);
  return sendSuccess(res, success, { user: buildUserPayload(user), ...tokens });
}
```

The handler reads top-to-bottom in three small steps:

```js
const oauth = await prisma.oAuthAccount.findUnique({ where: ..., include: { user: true } });
if (oauth) return respondWithSession(res, oauth.user);

const existing = await prisma.user.findUnique({ where: { email } });
if (existing) {
  await prisma.oAuthAccount.create({ data: { provider: "google", providerId: googleId, userId: existing.id } });
  return respondWithSession(res, existing);
}

const newUser = await prisma.user.create({
  data: { email, username: await generateUniqueUsername(name),
          oAuthAccounts: { create: { provider: "google", providerId: googleId } } },
});
return respondWithSession(res, newUser, Success.USER_CREATED);
```

### 7.3 `refresh` does a delete-then-create dance with no transaction

```js
await prisma.refreshToken.delete({ where: { id: storedToken.id } });
const tokens = await buildTokenPair(storedToken.userId);
```

If `generateRefreshToken` throws (DB hiccup), the user has lost their refresh token with nothing to replace it. Wrap in `prisma.$transaction`:

```js
return prisma.$transaction(async (tx) => {
  const stored = await tx.refreshToken.findUnique({ where: { token: hashToken(refreshToken) } });
  if (!stored) throw new PipelineError(Errors.INVALID_REFRESH_TOKEN);
  if (stored.expiresAt < new Date()) {
    await tx.refreshToken.delete({ where: { id: stored.id } });
    throw new PipelineError(Errors.REFRESH_TOKEN_EXPIRED);
  }
  await tx.refreshToken.delete({ where: { id: stored.id } });
  // generate new token in the same tx — pass tx into generateRefreshToken
  const accessToken = generateAccessToken(stored.userId);
  const refresh = await mintRefreshToken(stored.userId, tx);
  return { accessToken, refreshToken: refresh };
});
```

### 7.4 `hashToken` is duplicated between `authController.js` and `generateToken.js`

```js
// authController.js:27
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

// generateToken.js:17
const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
```

Same logic in two places. Move to one shared helper:

```js
// utils/tokenHash.js
export const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
```

---

## 8. `middleware/authMiddleware.js`

### 8.1 Drop the dead cookie branch

```js
} else if (req.cookies?.jwt) {
  token = req.cookies.jwt;
}
```

`cookie-parser` is not registered anywhere — `req.cookies` is always `undefined`. Either wire up cookies properly or delete this branch. Currently it's dead code that suggests a feature that doesn't exist.

### 8.2 The DB hit on every authenticated request is unnecessary

```js
const decoded = jwt.verify(token, process.env.JWT_SECRET);
const user = await prisma.user.findUnique({ where: { id: decoded.id } });
```

The JWT already encodes `{ id }`. Most authenticated handlers only use `req.user.id`. Two of them (`changePassword`, `setPassword`) also need `req.user.password` — they should fetch the user themselves.

```js
export const authMiddleware = (req, res, next) => {
  const m = req.headers.authorization?.match(/^Bearer\s+(\S+)$/);
  if (!m) return sendError(res, Errors.UNAUTHENTICATED);
  try {
    const { id } = jwt.verify(m[1], process.env.JWT_SECRET);
    req.user = { id };
    next();
  } catch {
    return sendError(res, Errors.UNAUTHENTICATED);
  }
};
```

For the password endpoints:

```js
export const changePassword = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { password: true } });
  // ... rest of the logic
});
```

This removes one DB hit from every authenticated request.

### 8.3 The error response shape disagrees with the rest of the app

```js
return res.status(401).json({ error: "Not authorized." });
```

Everywhere else the app uses `{ status, code, message? }`. This middleware is the odd one out. Use `sendError(res, Errors.UNAUTHENTICATED)`.

---

## 9. `middleware/validate.js`

### 9.1 The multer carve-out is dead

```js
if (source === "body" && req.file && Object.keys(req.body).length === 0) {
  return next();
}
```

No current route uses `multer` (the module is in `package.json` but nothing imports it). Remove until/unless a multipart endpoint exists.

### 9.2 Mutating `req.query` is fragile

```js
if (source === "query") {
  for (const k of Object.keys(req.query)) delete req.query[k];
  Object.assign(req.query, result.data);
} else {
  req[source] = result.data;
}
```

In Express 5, `req.query` is a getter. Don't mutate it. Use `req.validated`:

```js
export const validate = (schema, source = "body") => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) return sendError(res, Errors.INVALID_REQUEST, {
    issues: result.error.issues.map(i => ({ field: i.path[0], message: i.message })),
  });
  req.validated = result.data;
  next();
};
```

Handlers read `req.validated` instead of `req.body`. The contract is explicit: validation has happened, here's the parsed result.

---

## 10. `middleware/errorHandler.js`

### 10.1 All errors become `INTERNAL_SERVER_ERROR`

```js
return sendError(res, Errors.INTERNAL_SERVER_ERROR);
```

`PipelineError`s are converted in `aiRoutingController` but not anywhere else. Zod errors thrown outside `validate` middleware become 500s. Prisma `P2025` (record not found) becomes a 500. Recognise the common cases:

```js
export const errorHandler = (err, req, res, next) => {
  if (err instanceof PipelineError) {
    return sendError(res, { ...err.errorDef, message: err.message });
  }
  if (err instanceof z.ZodError) {
    return sendError(res, Errors.INVALID_REQUEST, {
      issues: err.issues.map(i => ({ field: i.path[0], message: i.message })),
    });
  }
  if (err?.code === "P2025") return sendError(res, Errors.NOT_FOUND);
  if (err?.code === "P2002") return sendError(res, Errors.CONFLICT);

  // unknown — log + generic 500
  req.log?.error({ err }, "unhandled");
  return sendError(res, Errors.INTERNAL_SERVER_ERROR);
};
```

---

## 11. Validators

### 11.1 `saveRouteSchema` accepts fields the DB doesn't store

```js
instructions: z.array(z.any()).optional(),
aiPlan: z.any().optional(),
variantLabel: z.string().optional(),
generationId: z.string().optional(),
isFavorite: z.boolean().default(false),
```

None of these are in the `Route` Prisma model. They're accepted by the validator and silently dropped (or, if Prisma is strict, cause an error). Either:

- Add the columns to the schema and persist them, or
- Remove them from the validator.

`isFavorite` in particular is specifically named "favorite" but no model field exists. This looks half-implemented.

### 11.2 `aiRouteSchema` and `aiRerouteSchema` are nearly identical

They differ only in: `aiRouteSchema` has `area`, `preferences`, `lang`. The `.refine` and the rest are duplicated. Extract a base:

```js
const baseRouteShape = {
  start: lngLat,
  end: lngLat.optional(),
  distance: z.number().min(500).max(100_000).optional(),
  profile: profile.default("foot-walking"),
  elevationPreference,
  waypoints: z.array(lngLat).optional().default([]),
};
const requireEndOrDistance = (d) => d.end || typeof d.distance === "number";

export const aiRerouteSchema = z.object(baseRouteShape).refine(requireEndOrDistance, {
  message: "Either end or distance is required", path: ["distance"],
});

export const aiRouteSchema = z.object({
  ...baseRouteShape,
  area: z.string().max(200).optional(),
  preferences: z.string().max(500).optional(),
  lang: z.enum(["en", "lt"]).default("en"),
}).refine(requireEndOrDistance, { message: "Either end or distance is required", path: ["distance"] });
```

### 11.3 `routeCoords.min(2)` has no `.max()`

```js
routeCoords: z.array(lngLat).min(2),
```

A 50,000-point array passes validation. Add `.max(20_000)` to bound the work `loopPoiSuggestions` will do.

---

## 12. `utils/responses.js`

### 12.1 `Errors` and `Success` lists are growing unbounded

23 error codes, 13 success codes. Many follow the "USER_*", "ROUTE_*", "PASSWORD_*" prefix pattern. Group them:

```js
export const Errors = {
  user: {
    EMAIL_EXISTS:    { code: "USER_EMAIL_EXISTS",    status: 400 },
    USERNAME_EXISTS: { code: "USER_USERNAME_EXISTS", status: 400 },
    NOT_FOUND:       { code: "USER_NOT_FOUND",       status: 404 },
  },
  password: {
    TOO_SHORT:        { code: "PASSWORD_TOO_SHORT",        status: 400 },
    DOES_NOT_MATCH:   { code: "PASSWORDS_DO_NOT_MATCH",    status: 400 },
    INVALID_CURRENT:  { code: "INVALID_CURRENT_PASSWORD",  status: 401 },
    ALREADY_SET:      { code: "PASSWORD_ALREADY_SET",      status: 400 },
    NOT_SET:          { code: "NO_PASSWORD_SET",           status: 400 },
  },
  // ...
};
```

Callers become `sendError(res, Errors.user.EMAIL_EXISTS)`. Easier to scan, easier to grep.

### 12.2 `setupSSE` is fine but the event schema is implicit

The two consumers (`aiRoutingStream`) emit `stage`, `done`, `error`. There's no central definition of what each event's payload looks like. Document or schema it:

```js
// utils/sseEvents.js
export const Events = {
  STAGE: "stage",
  DONE: "done",
  ERROR: "error",
};
export const StagePayload = z.object({ stage: z.string(), mode: z.string().optional() });
```

Even if Zod is overkill for SSE, having the constants in one place stops typo-driven bugs.

---

## 13. `utils/http.js`

### 13.1 `fetchWithRetry` and `fetchWithTimeout` are mostly fine

The only awkward thing: `fetchWithRetry` swallows the body of a 429/5xx response when retrying. If the final attempt fails, the caller gets `lastErr = new Error("HTTP 503")` with no body context. Append response body to the error message on the last attempt:

```js
if (attempt === retries) {
  const body = await res.text().catch(() => "");
  lastErr = new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
}
```

### 13.2 The retry policy is the same for every vendor

All ORS and Overpass calls go through `fetchWithRetry` with `retries = 3, baseDelayMs = 600`. ORS POI is fast and idempotent — retry aggressively. Overpass is slow and rate-limited — back off harder. Allow per-call override:

```js
fetchWithRetry(url, opts, { retries: 5, baseDelayMs: 300 });        // ORS
fetchWithRetry(url, opts, { retries: 2, baseDelayMs: 2000 });       // Overpass
```

The signature already supports it; just use it.

---

## 14. Cross-cutting: magic numbers

These constants are scattered across files and would be easier to reason about in one place:

| Constant | File | Purpose |
|---|---|---|
| `MATRIX_SOURCE_COUNT` (10), `MATRIX_MAX_LOCATIONS` (50), `BARRIER_MAX_ROUTED_M` (3500) | `routeGenerationController.js` | reachability |
| `ALWAYS_KEEP_M` (300), `DETOUR_RATIO_MAX` (3.0) | `lib/ai/reachability.js` | reachability |
| `SUGGESTION_LIMIT` (15), `SUGGESTION_CORRIDOR_M` (800) | `routeGenerationController.js` | POI suggestions |
| `SNAP_THRESHOLD_M` (per profile) | `lib/ai/waypoints.js` | waypoint snapping |
| `ORS_WAYPOINT_CAP` (20), `GEMINI_MODEL` | `lib/ai/shared.js` | AI |
| `TAIL_FRACTION` (0.2), `DISTANCE_TOLERANCE` (0.12), `MAX_SCALE_PASSES` (4), `MAX_CLEAN_ITERATIONS` (8) | `lib/loop-algo.js` | loop generation |
| `LOOP_DISTANCE_TOLERANCE` (0.12) | `routeGenerationController.js` | duplicates `DISTANCE_TOLERANCE` above |
| `ORS_POI_CHUNK_SIZE` (40), `ORS_MAX_RESULTS` (100) | `lib/ors.js`, `lib/places.js` | ORS POI batching |

Move into `src/config/constants.js`:

```js
export const REACHABILITY = {
  MATRIX_SOURCE_COUNT: 10,
  MATRIX_MAX_LOCATIONS: 50,
  ALWAYS_KEEP_M: 300,
  DETOUR_RATIO_MAX: 3.0,
  // pick ONE max-routed-m, used by all callers
  MAX_ROUTED_M: 3500,
};
export const POI = { SUGGESTION_LIMIT: 15, SUGGESTION_CORRIDOR_M: 800 };
export const LOOP = { TAIL_FRACTION: 0.2, DISTANCE_TOLERANCE: 0.12, MAX_SCALE_PASSES: 4 };
export const SNAP_THRESHOLD_M = { /* per-profile map */ };
```

Importantly, this surfaces the duplicate `DISTANCE_TOLERANCE` / `LOOP_DISTANCE_TOLERANCE` (same value, two places, drift risk).

---

## 15. Recommended sequence

The refactors are mostly independent; this order minimises rebases:

1. **Trivial cleanups** (½ day each)
   - Drop dead cookie branch in `authMiddleware`.
   - Fix `signup` two-query → one-query.
   - Drop `multer` carve-out in `validate.js`.
   - Switch `validate.js` to `req.validated`.
   - Standardise `bcrypt.hash` rounds to 12 in `userController.changePassword`.
   - Skip the second `detectMode` call (heuristic short-circuit).
   - Add `routeCoords.max(20_000)`.
   - Remove or implement the `isFavorite`/`aiPlan`/`generationId` validator fields.
   - Sync `PROFILE_CONFIGS` with the validator enum (`cycling-electric`).

2. **Deduplication** (1–2 days)
   - Merge two `filterReachablePois` implementations.
   - Extract `pickByElevation`, `findCheapestInsertion`, `toResponseRoute`, `selectWaypoints` from controllers.
   - Extract `loadOwnedRoute` middleware; strip ownership checks.
   - Merge three `normalize` implementations into `normalizeForMatch`.
   - Move `hashToken` to one place.
   - Centralise constants into `config/constants.js`.

3. **Module splits** (2–3 days)
   - Split `places.js` into `lib/places/{poi-types-map,overpass,ors-pois,nominatim,named-resolver,utils}.js`.
   - Move scoring helpers out of `routeGenerationController` into `domain/routes/poi-scoring.js`.
   - Move reachability to `domain/routes/reachability.js`.

4. **Pipeline refactor** (3–4 days)
   - Extract pipeline stages into pure functions over `state`.
   - Combine `extractSpatialAreas` + `detectMode` + `decomposeIntent` into one planning call.
   - Replace `.catch(() => [])` with explicit `degradations[]`.
   - Add Zod validation for every Gemini output.

5. **Auth hardening** (1 day)
   - Slim `authMiddleware` (no DB hit), update password handlers to fetch user themselves.
   - Wrap refresh-token rotation in a transaction.
   - Standardise `errorHandler` to handle `PipelineError`, `ZodError`, common Prisma codes.

By the end of step 4, the AI pipeline should be ~200 lines instead of 766, the route controller ~300 lines instead of 636, and `places.js` should be gone entirely.
