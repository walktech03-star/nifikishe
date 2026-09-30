# NIFIKISHE

**Kutoka ulipo, hadi unakokwenda.** — Swahili-first multi-modal public transit navigation for Tanzania.

## What is in the app

Two views in one site:

1. **Landing / consumer website** (`#landingView`) — hero with an instant journey search widget, feature highlights, transit-mode showcase, footer with city shortcuts.
2. **Navigation workspace** (`#appWorkspaceView`) — split layout with the search panel on the left and the live Leaflet map on the right.

Core transit features:

| Feature | Where |
| --- | --- |
| City-independent data architecture (cities, areas, routes, stops, places as separate stores) | `data/*.json` |
| Journey search with 3 route options (direct daladala, daladala+walk, daladala+BRT Mwendokasi) | `POST /api/navigation/search` |
| Vehicle identification cues: route signboard text, vehicle type/colour and the exact Swahili question to ask the conductor | route detail panel |
| Step-by-step journey timeline (walk → board → stay on board → alight → walk) | route detail panel |
| Live transit simulation with progress bar and spoken Swahili guidance (Web Speech API) | "Anza Safari" |
| Kariakoo sub-area micro-navigation (8 market categories, street-by-street walking directions) | `GET /api/complex-areas/kariakoo` |
| Crowdsourced transit reports | `POST /api/reports` |
| Admin analytics overview | `GET /api/admin/overview` |
| Saved trips (offline, localStorage) | star button on the map |
| Bilingual UI with a Swahili-first dictionary | `SW` / `EN` header toggle |
| Installable PWA (manifest + service worker, offline shell) | `/manifest.json`, `/sw.js` |

## Running it

```bash
npm install
npm start          # http://localhost:3000
```

Open `http://localhost:3000/` for the landing page, or `http://localhost:3000/?mode=app` to boot straight into the navigation workspace.

## Verifying it

```bash
npm run verify         # data, syntax, handler/DOM wiring, i18n coverage, CSS coverage
npm run verify:live     # the above + smoke test every route/asset against a running server
```

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/cities` | Countries, cities and sub-areas |
| GET | `/api/cities/:id` | One city plus its areas |
| GET | `/api/stops` | Stops, optionally filtered by `city`, `lat`, `lng`, `maxDistance` |
| GET | `/api/places` | Places filtered by `city`, `category`, `q` |
| GET | `/api/routes` | Routes filtered by `city`, `transportType` |
| POST | `/api/navigation/search` | Journey search (`origin`, `destination`, `city`, `sortBy`) |
| GET | `/api/complex-areas/:areaId` | Internal micro-navigation for a market/commercial zone |
| GET | `/api/search?q=` | Unified ranked search across places, stops and routes |
| GET | `/api/live/vehicles` | Fleet positions — REAL drivers first, simulated fill-in (`realCount`, `real`, `updatedSecondsAgo`) |
| GET | `/api/live/nearby` | Nearest stops × next vehicles with ETAs (marks `real` live buses) |
| POST | `/api/live/ingest` | Driver GPS ingest (`vehicleId`, `routeId`, `lat`, `lng`, `speedKph`, `heading`, `occupancy`) |
| POST | `/api/live/stop` | Driver goes offline (removes vehicle) |
| POST | `/api/reports` | Submit a crowdsourced transit report |
| GET | `/api/admin/overview` | Platform statistics and analytics |

## Driver live tracking (`/driver.html`)

A driver opens `/driver.html` on a phone, picks their route, and taps Start.
The phone posts GPS to `POST /api/live/ingest` every 10 seconds; passengers
see those real vehicles first via `GET /api/live/vehicles` and
`GET /api/live/nearby` (routes with no driver online still show a scheduled
fill-in so the map never looks empty). `POST /api/live/stop` takes a driver
offline. Set an optional shared `DRIVER_KEY` env var to protect ingest.

## Layout

```
data/                JSON stores (city-independent transit data)
public/
  index.html         landing view + navigation workspace + modals
  css/style.css      design system (tokens, landing, workspace, responsive)
  js/app.js          app orchestrator: search, routes, simulation, saved trips
  js/i18n.js         Swahili/English dictionary and language switching
  js/map-service.js  map provider abstraction (Leaflet today)
   js/live-gps.js     passenger live GPS follow + nearby-vehicle panel
   js/driver.js       driver phone GPS streaming (/driver.html)
   js/admin-panel.js  admin data-entry panel (routes, stops, reports)
  images/            vehicle illustrations (daladala, BRT)
  icons/             app icon
server.js            Express API + static hosting
tools/verify.js      integrity and smoke-test harness
```

## Notes and limitations

- Route, stop and fare data are a curated prototype dataset for Dar es Salaam; the schema is
  city-independent but only Dar es Salaam has full route coverage today.
- The live journey view is a client-side replay of route geometry, not real vehicle telemetry.
- Saved trips live in `localStorage`, so they are per-device.
- Spoken guidance depends on the browser having a Swahili voice; it degrades silently otherwise.
- Persistence is still JSON-file based. The next step is a PostgreSQL + PostGIS migration.
