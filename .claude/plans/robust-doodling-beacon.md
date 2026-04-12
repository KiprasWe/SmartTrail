# SmartTrail — Full Improvement & Route Generation Plan

## Context

SmartTrail is a trail/outdoor app (Expo RN + Express backend) with working auth and social features, but the core feature — route generation — is only partially built. The backend has a working Valhalla-based A→B endpoint, but the frontend is missing the `useGenerate` hook, both form components, and the route map screen. There's also significant code cleanup needed: duplicate auth/profile implementations, security issues (.env in git), inconsistent validation, no pagination, and scattered types.

This plan covers: (1) code cleanup, (2) API strategy for route generation, (3) database design, (4) frontend implementation, (5) backend improvements.

---

## Part 1: Code Cleanup

### 1A. Delete duplicate auth code

- **Delete** `app/smart-trail/context/auth-context.tsx` — legacy Context API duplicate of `store/use-auth-store.ts` (Zustand). The Zustand store is already used by `_layout.tsx` and all screens.
- Remove the `context/` directory if empty.

### 1B. Delete duplicate profile hook

- **Delete** `app/smart-trail/hooks/use-user-profile.ts` — duplicates `store/use-profile-store.ts`.
- Verify no screen still imports from the deleted hook (profile.tsx and edit-profile.tsx should use `useProfileStore`).

### 1C. Create shared type definitions

Types are scattered and duplicated across files. Create `app/smart-trail/types/`:

- `types/auth.ts` — `AuthUser` (from `use-auth-store.ts`)
- `types/profile.ts` — `UserProfile`, `EditForm` (from both profile files)
- `types/route.ts` — `LatLng`, `RouteVariant`, `RoutePayload`, `SavedRoute`, `ElevationPref`, `DirectionKey`, `TransportMode`
- `types/social.ts` — `SocialUser`, `FollowRequest` (from `use-social.ts`)
- `types/index.ts` — barrel re-exports

### 1D. Fix route-constants.ts

Complete the transport enum and add `as const`:

```typescript
export const TRANSPORT = {
  walking: "walking",
  hiking: "hiking",
  running: "running",
  cycling: "cycling",
  mtb: "mtb",
  ebike: "ebike",
} as const;
```

### 1E. Fix password validation inconsistency

- `backend/src/validators/authValidators.js` — change signup password from `.min(6)` to `.min(8)` to match set-password/change-password validators.

### 1F. Security — remove .env from git

- Add `backend/.env` to `.gitignore`
- `git rm --cached backend/.env`
- Create `backend/.env.example` with placeholder values
- **Rotate all committed secrets** (JWT_SECRET, R2 creds, API keys, DB password)

### 1G. Add missing translations

- Add keys to `locales/en.json` and `locales/lt.json` for: generate screen, route map, settings, onboarding, transport modes, elevation preferences, direction picker, POI categories.

---

## Part 2: Route Generation — API Strategy

### Why these APIs

| Concern                 | API                                     | Why                                                                                                                  |
| ----------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Routing (all modes)** | **Valhalla** (free, already working)    | No API key needed, unlimited, good pedestrian/cycling profiles, returns elevation, turn-by-turn. Already integrated. |
| **Geocoding**           | **Photon** (free, already working)      | OSM-based, no key, already integrated in `lib/generate-utils.ts`                                                     |
| **POIs**                | **ORS** (free tier, already integrated) | API key configured, 500 req/day free. Fallback: Overpass API (unlimited)                                             |
| **AI planning**         | **Gemini** (key configured)             | Generates interesting waypoint lists. Valhalla does the actual routing.                                              |
| **Elevation**           | **Valhalla** (built-in)                 | Already returns elevation data in route shape. No separate API needed.                                               |

**NOT using**: GraphHopper (redundant with Valhalla, adds rate limits), Google Places (expensive, unnecessary).
Remove unused `GRAPHHOPPER_API_KEY` and `GOOGLE_PLACES_API_KEY` from `.env`.

### 2A. A→B Routes (polish existing)

**File**: `backend/src/controllers/routesController.js`

Current `generateAtoB` works but needs:

1. Input validation via Zod schema (currently inline `if (!start?.lat)`)
2. Wrap response in `sendSuccess()` for consistency
3. Extract magic numbers (offsets, dedup threshold) into named constants
4. Add elevation data — set `"elevation_above_sea_level": true` in Valhalla requests
5. Support optional `via` waypoint from frontend
6. Map `elevationPref` (flat/mixed/hilly) to Valhalla's `use_hills` costing option

### 2B. Loop Routes (new endpoint)

**New endpoint**: `POST /routes/generate-loop`

**Algorithm**:

1. Accept: `start` (LatLng), `distance` (meters), `transport`, `direction?` (compass), `elevationPref?`
2. Compute bearing from direction (or random). Generate 3-4 waypoints in a rough circular shape at distances proportional to target distance.
3. Route: start → wp1 → wp2 → wp3 → start via Valhalla with `type: "through"` intermediates
4. If result distance is >25% off target, adjust waypoint spread and retry (max 3 attempts)
5. Generate 2-3 variants by rotating/offsetting waypoint positions

### 2C. AI Routes (new endpoint)

**New endpoint**: `POST /routes/generate-ai`

**Flow**:

1. Accept: `start`, optional `end`, `transport`, `area` (text), `preferences` (text), `elevationPref?`
2. Send structured prompt to **Gemini API** asking for 3-8 interesting waypoints between start/end matching preferences
3. Gemini returns JSON: `{ title, description, waypoints: [{ name, lat, lng, why }] }`
4. Route through all waypoints using Valhalla
5. Optionally fetch POIs near waypoints via ORS
6. Return route + AI plan metadata + POIs

### 2D. Elevation Enhancement

- Add `"elevation_above_sea_level": true` to all Valhalla route request bodies
- Update `decodePolyline6` to optionally decode 3D coords (lat, lng, elevation)
- Return elevation profile: `{ points: [{distance, elevation}], totalAscent, totalDescent, min, max }`

---

## Part 3: Database Design

### 3A. Add Route model to Prisma schema

**File**: `backend/prisma/schema.prisma`

```prisma
model Route {
  id             String    @id @default(uuid())
  userId         String
  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  title          String
  description    String?
  mode           RouteMode
  transport      String

  distance       Int          // meters
  duration       Int          // seconds
  ascent         Int?
  descent        Int?
  geometry       Json         // GeoJSON LineString
  bbox           Json
  instructions   Json?
  elevationProfile Json?

  startLat       Float
  startLng       Float
  startLabel     String?
  endLat         Float?
  endLng         Float?
  endLabel       String?

  aiPlan         Json?        // AI waypoints/descriptions
  pois           Json?

  variantLabel   String?      // "shortest", "alternative", "scenic"
  generationId   String?      // groups variants from same generation

  isFavorite     Boolean   @default(false)
  isPublic       Boolean   @default(false)

  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@index([userId])
  @@index([generationId])
}

enum RouteMode {
  A_TO_B
  LOOP
  AI
}
```

Add `routes Route[]` relation to `User` model.

### 3B. Add missing indexes to Follow table

```prisma
@@index([followerId])
@@index([followingId])
@@index([followingId, status])
```

---

## Part 4: Frontend Implementation

### 4A. `hooks/use-generate.ts` — the core hook

**Must return** everything `app/(tabs)/index.tsx` destructures from `g`:

- State: `mode`, `aiMode`, `startLabel/Coords`, `endLabel/Coords`, `viaLabel/Coords`, `aiStartLabel/Coords`, `aiEndLabel/Coords`, `area`, `preferences`, `transport`, `elevationPref`, `direction`, `distance`, `customDistance`, `poiCategories`, `locating`, `userCoords`, `generating`
- Setters: all corresponding `set*` functions
- Computed: `canGenerate`, `accent`, `surface`, `border`, `dropBg`, `isDark`, `t` (Colors), `insets`
- Actions: `handleGenerate`, `handleLocateMe`, `handleAiLocateMe`, `togglePoiCategory`, `clearPoiCategories`

Use `useState` (ephemeral form state, not global). `handleGenerate` calls the appropriate backend endpoint, stores result in route store, navigates to `route-map`.

### 4B. Form components

Create `app/smart-trail/components/generate/`:

1. **`place-search-input.tsx`** — reusable geocoding search using existing `searchPlaces` from `lib/generate-utils.ts`. Dropdown suggestions, selection/clear.

2. **`standard-route-form.tsx`** — for A→B and Loop modes:
   - Place inputs (start, end for A→B, start for loop)
   - Optional via waypoint
   - Distance selector (loop: 3/5/10/15/20km presets + custom)
   - Direction compass (loop only)
   - Transport mode selector
   - Elevation preference (flat/mixed/hilly)
   - POI category toggles

3. **`ai-route-form.tsx`** — for AI mode:
   - Start location + optional end
   - Area description text input
   - Preferences text input
   - Transport + elevation selectors

### 4C. Route map screen

**File**: `app/smart-trail/app/route-map.tsx` (currently empty)

Use `@maplibre/maplibre-react-native` (free, no API key, supports offline tiles):

1. Draw route polyline(s) on free vector tiles (OpenFreeMap)
2. Variant selector cards at bottom (scrollable, shows distance/duration/ascent)
3. Elevation profile mini-chart
4. POI markers on map
5. Turn-by-turn instructions in bottom sheet
6. Action buttons: Save, Export GPX, Share

### 4D. Route store (Zustand)

**File**: `app/smart-trail/store/route-store.ts`

Store current generation result (`RoutePayload` with variants array) for the route-map screen to consume.

### 4E. Saved routes store

**File**: `app/smart-trail/store/saved-routes-store.ts`

Hybrid: save to backend DB + cache locally in AsyncStorage for offline access.

---

## Part 5: Backend Improvements

### 5A. Route input validation

**Create**: `backend/src/validators/routeValidators.js`

Zod schemas for all three endpoints with proper coordinate bounds, transport enum, distance limits.

### 5B. Route saving endpoints

**Add to** `backend/src/routes/routesRoutes.js`:

- `POST /routes/save` — save generated route
- `GET /routes/saved` — list user's saved routes (paginated)
- `GET /routes/saved/:id` — get single route
- `DELETE /routes/saved/:id` — delete route
- `PATCH /routes/saved/:id` — update title/favorite/public

### 5C. Consistent response format

Wrap route endpoint responses in `sendSuccess()`. Add route-specific codes to `responses.js`:

- Success: `ROUTE_GENERATED`, `ROUTE_SAVED`, `ROUTE_DELETED`, `ROUTES_FETCHED`
- Errors: `ROUTE_NOT_FOUND`, `VALHALLA_ERROR`, `AI_GENERATION_FAILED`

### 5D. Pagination

Create `backend/src/utils/pagination.js` — reusable helper (page, limit, defaults 1/20, max 50).
Apply to: `searchUsers`, `getFollowers`, `getFollowing`, `getFollowRequests`, `GET /routes/saved`.

### 5E. Rate limiting

Install `express-rate-limit`. Add to `server.js`:

- Global: 100 req/min/IP
- Auth: 10 req/min/IP
- Route generation: 10 req/min/user

### 5F. CORS

Add `cors` middleware to `server.js` with configurable origin.

### 5G. Extract magic numbers

In `routesController.js`, replace hardcoded offsets/thresholds with named constants.

---

## Implementation Order

| Phase                 | What                                                                      | Key Files                                                                                                  |
| --------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **1. Cleanup**        | Delete duplicates, create types, fix validation, secure .env              | `context/auth-context.tsx`, `hooks/use-user-profile.ts`, `types/`, `.gitignore`, `authValidators.js`       |
| **2. Backend infra**  | Validation, response format, pagination, rate limiting, CORS, Route model | `routeValidators.js`, `routesController.js`, `responses.js`, `pagination.js`, `schema.prisma`, `server.js` |
| **3. Backend routes** | Loop endpoint, AI endpoint, elevation, save/list/delete                   | `routesController.js`, `routesRoutes.js`                                                                   |
| **4. Frontend forms** | useGenerate hook, PlaceSearchInput, StandardRouteForm, AiRouteForm        | `hooks/use-generate.ts`, `components/generate/*`                                                           |
| **5. Route map**      | Map display, variant selector, elevation chart, POIs, save/export         | `app/route-map.tsx`, `store/route-store.ts`                                                                |
| **6. Polish**         | Translations, saved routes, GPX export, offline caching                   | `locales/*`, `store/saved-routes-store.ts`, `lib/gpx-export.ts`                                            |

---

## Verification

1. **Cleanup**: Run `npx tsc --noEmit` in app — no type errors from deleted files
2. **Backend validation**: Send malformed requests to `/routes/generate-a-to-b` — should get 400 with Zod errors
3. **A→B generation**: POST valid coords → get 3 route variants with elevation data
4. **Loop generation**: POST start + distance → get circular route variants within ±25% of target distance
5. **AI generation**: POST start + preferences → get Gemini-planned waypoints routed via Valhalla
6. **Frontend flow**: Open Generate tab → fill form → tap Generate → see routes on map with variant selector
7. **Save flow**: Save route from map → see it in saved routes list → delete it
8. **Rate limiting**: Rapid-fire requests → get 429 after limit
