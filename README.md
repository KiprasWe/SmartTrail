# SmartTrail

AI-assisted trail and route planning — mobile app + REST API.

## Monorepo structure

```
SmartTrail/
├── backend/          Express 5 + Prisma + PostgreSQL REST API
└── app/smart-trail/  Expo SDK 54 / React Native mobile app
```

## Quick start

### Prerequisites

- Node.js ≥ 20
- PostgreSQL (local or Docker)
- [Expo CLI](https://docs.expo.dev/get-started/installation/)

### 1 — Backend

```bash
cd backend
cp .env.example .env      # fill in your credentials
npm install
npx prisma migrate dev    # apply migrations
npm run dev               # starts on :5001
```

### 2 — Frontend

```bash
cd app/smart-trail
cp .env.example .env      # set EXPO_PUBLIC_API_URL to your backend
npm install
npm start                 # opens Expo dev server
```

## Environment variables

See [`backend/.env.example`](backend/.env.example) and [`app/smart-trail/.env.example`](app/smart-trail/.env.example).

**Never commit `.env` files.** Use `backend/.env.example` as the canonical list of required variables.

## Pre-commit hooks

Secret scanning and linting run automatically via [lefthook](https://github.com/evilmartians/lefthook):

```bash
npx lefthook install
```

Requires [gitleaks](https://github.com/gitleaks/gitleaks) to be installed (`brew install gitleaks` on macOS or download from releases).

## Architecture notes

- **Auth**: JWT access tokens (15 min) + hashed refresh tokens (30 days). Google OAuth via `expo-auth-session` + `google-auth-library`.
- **Routing**: [Valhalla via Stadia Maps](https://stadiamaps.com/) for A→B/loop; ORS for alternatives.
- **AI planning**: Gemini 2.5 Flash selects POIs; Google Places API enriches with photos.
- **Maps**: MapLibre GL + OpenFreeMap tiles (free vector tiles, no API key required).
- **Storage**: Cloudflare R2 for profile pictures; PostgreSQL via Prisma for everything else.

## API health check

```bash
curl http://localhost:5001/health
# {"status":"ok","timestamp":"..."}
```
