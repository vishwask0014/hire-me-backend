# HireMe Backend

Custom Node.js backend API for HireMe.

## Run
```bash
npm run dev
```

Backend runs on `http://localhost:4000`.

## Environment
- `PORT` (default: `4000`)
- `FRONTEND_ORIGIN` (default: `http://localhost:3000`)

## API Endpoints
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/requirements`
- `POST /api/requirements`
- `GET /api/requirements/:id`

## Backend Architecture
1. API Layer (`src/server.js`)
- Node HTTP server with route handlers.
- Handles CORS and cookies.

2. Validation Layer
- Validates signup/login and requirement payloads.

3. Auth/Session Layer
- Cookie-based session token (`hireme_session`).
- Session expiry and cleanup.

4. Persistence Layer (`data/*.json`)
- `users.json`
- `sessions.json`
- `requirements.json`

## Authorization Rules
- Any authenticated user can view requirements.
- Only `hirer` users can create requirements.
