# EcoPass landing page CMS

This project includes a public EcoPass landing page and a real server-backed content dashboard. Text is persisted in `data/site-content.json`; uploaded images are stored in `uploads/`. The public page has no editing or upload controls.

## Run it

1. Copy `.env.example` to `.env`.
2. Replace `ADMIN_PASSWORD` with a strong private password. Without it, the public site still runs but admin sign-in stays locked.
3. Replace `SESSION_SECRET` with a long random value.
4. Run `npm start`.
5. Open `http://localhost:3000/` for the landing page and `http://localhost:3000/admin` for the dashboard.

In PowerShell, a quick setup is:

```powershell
Copy-Item .env.example .env
notepad .env
npm start
```

The dashboard supports editing all main landing-page text, uploading/replacing images, removing uploaded images to restore defaults, previewing the public page, and signing out. Saves use atomic file replacement. Admin sessions are signed, HTTP-only, same-site cookies; write endpoints require authentication and same-origin requests. Login attempts are rate limited, and uploaded files are checked by MIME type and file signature with a 5 MB limit.

## Production notes

Run this behind HTTPS and persist both `data/` and `uploads/` on durable storage. Back up those directories. Keep `.env` private. On Railway, attach a Volume, mount it at `/data`, and set `STORAGE_ROOT=/data`; EcoPass will keep content in `/data/data` and uploads in `/data/uploads`. The `/health` endpoint is available for deployment health checks. If deploying to a serverless host, replace the filesystem storage adapter with that host's database and object storage while preserving the API contract.

Run the automated checks with `npm test`.

## Visitor booth map and directions

The landing-page map reads only published active booths from `GET /api/booths`. Its default MapLibre terrain view has a Leaflet 2D fallback. The public map does not edit booth locations or expose staff notes, contacts, or tourist records.

Visitors can request walking/driving directions from their browser location or select a starting point on the map. Routes, estimates, and steps stay inside EcoPass. No Google Maps redirect is used. Location permission is requested only after pressing **Get directions**; the starting point is sent directly to the [FOSSGIS OSRM service](https://routing.openstreetmap.de/about.html). The UI discloses that this provider logs route requests. EcoPass keeps coordinates only in browser memory, not in application storage. Cancel/booth changes clear the route and tracking; hiding the tab pauses an active GPS watch.

Routing requests are user-initiated and spaced by at least 1.5 seconds per browser client. There is no automatic rerouting or live traffic; visitors request a fresh route if they leave it. This community routing service has fair-use limits and no availability guarantee. Before high-volume use, replace the provider in `visitor-routing.js` with an appropriately provisioned service and update the privacy disclosure. Keep OSM/FOSSGIS attribution and the Fix the map link. Unavailable or disconnected routes show an error instead of a fabricated straight-line road route.

The routing tests use synthetic positions, a fake provider, and mocked browser geolocation, including cancellation races and denied/inaccurate GPS. UI smoke tests should use a chosen public road point, not a tester's actual location unless they explicitly consent to sharing it with the routing provider.

## Payment logo credits

Payment marks are used only to identify available payment methods; their owners do not endorse EcoPass. The [GCash logo](https://commons.wikimedia.org/wiki/File:GCash_logo.svg), [Maya logo](https://commons.wikimedia.org/wiki/File:Maya_logo.svg), [Mastercard symbol](https://commons.wikimedia.org/wiki/File:Mastercard_2019_logo.svg), and [Visa logo](https://commons.wikimedia.org/wiki/File:Visa_Inc._logo_%282021%E2%80%93present%29.svg) are displayed without alteration. The Maya logo is credited to Maya Bank, Inc. and PayMaya Philippines, Inc. under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
