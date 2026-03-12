# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Structure

SmartTrail is a monorepo with two separate projects:

- `app/smart-trail/` — React Native / Expo mobile app (TypeScript)
- `backend/` — Node.js / Express REST API (ESM, JavaScript)

## Commands

### Frontend (app/smart-trail/)

```bash
npm start           # Start Expo dev server (opens QR + tunnel)
npm run android     # Run on Android device/emulator
npm run ios         # Run on iOS simulator
npm run web         # Run in browser
npm run lint        # ESLint via expo lint
```

### Backend (backend/)

```bash
npm run dev         # Start with nodemon (hot reload)
npx prisma migrate dev      # Apply pending migrations
npx prisma generate         # Regenerate Prisma client after schema changes
npx prisma studio           # Open Prisma visual DB browser
```

## Architecture

### Auth Flow

The app uses JWT access tokens (15 min) + refresh tokens (30 days stored hashed in DB). Tokens are persisted to device via `expo-secure-store`. On boot, `AuthProvider` (`context/auth-context.tsx`) restores session from secure storage. Route protection is handled in `app/_layout.tsx` using `Stack.Protected` — unauthenticated users are redirected to `app/auth.tsx`, authenticated users to `app/(tabs)/`.

Google OAuth uses `expo-auth-session` on the client; the resulting `id_token` is sent to `POST /auth/google` for server-side verification via `google-auth-library`.

### Frontend Navigation

Expo Router file-based routing:

- `app/_layout.tsx` — root layout, wraps everything in `AuthProvider`, handles auth guard
- `app/(tabs)/` — tab navigator (Generate, Profile tabs)
- `app/auth.tsx` — combined sign-in/sign-up screen

`@/` path alias resolves to `app/smart-trail/` root (configured in `tsconfig.json`).

Styling uses **NativeWind** (Tailwind for React Native) via `global.css` + `tailwind.config.js`. Theme tokens are in `constants/theme.ts`.

### Backend Structure

Express 5 app with ESM modules (`"type": "module"` in package.json):

- `src/server.js` — entry, mounts routes at `/auth` and `/user`
- `src/config/db.js` — Prisma client with `@prisma/adapter-pg` (PostgreSQL)
- `src/middleware/authMiddleware.js` — JWT verification, attaches `req.user`
- `src/routes/` + `src/controllers/` — standard route/controller split
- `src/utils/generateToken.js` — access token (JWT) + refresh token (hashed random bytes stored in DB)

### Database (Prisma + PostgreSQL)

Three models: `User`, `OAuthAccount` (supports Google/Apple/GitHub), `RefreshToken`. Users created via Google OAuth have no password; `setPassword` endpoint allows them to add one later.

Local DB: `postgresql://postgres:admin@localhost:5432/smarttrail`

## Environment Variables

**Backend** (`backend/.env`):

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET`, `JWT_EXPIRES_IN` — token config
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth
- `ORS_API_KEY` — OpenRouteService API key (for trail routing, not yet wired up)

**Frontend** (`.env` or EAS secrets with `EXPO_PUBLIC_` prefix):

- `EXPO_PUBLIC_API_URL` — backend base URL
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`

## API Response Convention

All backend responses follow `{ status: "success" | "error", data: {...} }` or `{ error: "message" }` for errors.

Protected routes require `Authorization: Bearer <accessToken>` header.

## External Documentation

When working with any library or framework in this repo, **always use Context7 to fetch up-to-date documentation** before writing or modifying code. This is especially important for:

- **Expo / React Native** — APIs change frequently between SDK versions
- **Express.js** — particularly Express 5, which has breaking changes from v4
- **Prisma** — schema syntax, migrations, and client API
- **NativeWind / Tailwind** — utility class availability and config

### How to use Context7

Before implementing any feature or fixing a bug involving a third-party library, call the Context7 MCP tool to resolve the library and fetch relevant docs. Example workflow:

1. Resolve the library ID: `mcp__context7__resolve-library-id` with the package name
2. Fetch relevant docs: `mcp__context7__get-library-docs` with the resolved ID and a focused topic query

Never rely on training data alone for library APIs — always verify with Context7 first.
