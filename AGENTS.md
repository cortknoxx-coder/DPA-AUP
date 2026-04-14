# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

**DPA (Digital Playback Asset)** — a hardware device + software platform for physical music ownership. Built by The DPAC (Digital Playback Asset Consortium).

This repo (`DPA-AUP`) contains three major parts:

1. **Angular 21 Portal** (root `src/`, `index.tsx`) — Creator & Fan web app
2. **ESP32-S3 Firmware** (`firmware/dpa-esp32/`) — Device firmware in Arduino/C++
3. **Vercel Cloud Backend** (`api/`, `middleware.js`) — Serverless functions, Edge Middleware, cron jobs

The Angular app runs standalone with mock data locally (no backend needed). When deployed to Vercel with environment variables, it connects to Neon Postgres, Upstash Redis, Vercel Blob, and Edge Config for persistent cloud state. The firmware runs on a Waveshare ESP32-S3 Zero with PCM5122 DAC, microSD, WS2812B LEDs, and hardware buttons.

### Dev commands

| Action | Command |
|--------|---------|
| Install deps | `npm install --legacy-peer-deps` |
| Dev server | `npm run dev` (serves on port 3000) |
| Production build | `npm run build` |
| Ingest server | `npm run ingest:server` |
| Deploy to Vercel | `npm run deploy:vercel` |

### Non-obvious caveats

- **`--legacy-peer-deps` required**: Angular 21 requires TypeScript >=5.9 but `package.json` pins `^5.9.3`. Use `npm install --legacy-peer-deps` to avoid `ERESOLVE` peer-dependency conflicts.
- **No lint or test scripts**: The repo has no ESLint config or test framework configured.
- **No `.env` needed locally**: The app runs fully without environment variables in dev mode. Cloud features (Postgres, Redis, Blob, Edge Config) require Vercel environment variables in production.
- **Simulator mode**: The app references a WebSocket bridge (`ws://localhost:8787`) and a REST API (`http://localhost:8080/api/v1`) in `dpa-config.ts`, but gracefully falls back to simulator/mock mode when these are unavailable.
- **ESP32 mock server**: `.claude/launch.json` contains a Node.js mock server config (`esp32-dash`) on port 4300 that simulates all firmware REST API endpoints for dashboard development without real hardware.
- **Dashboard proxy**: `firmware/dpa-esp32/proxy.cjs` proxies `/api/*` to a real device at `192.168.4.1` while serving `dashboard.html` locally (port 4301).
- **Dual web servers**: Firmware runs ESPAsyncWebServer on port 80 (dashboard + API) and a synchronous WebServer on port 81 (large file uploads). This split is required because ESPAsyncWebServer has bugs with large multipart uploads.
- **Cloud API routing**: `vercel.json` rewrites `/internal-api/*` to serverless functions. Edge Middleware gates admin routes behind operator session cookies.

### Project status (as of April 2026)

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1 — Hardware & Firmware Foundation | **COMPLETE** | ESP32 firmware, I2S audio, SD WAV playback, 29 LED patterns, buttons, battery |
| Phase 2 — Dashboard & Web API | **COMPLETE** | REST API (`api.h`), gzipped dashboard from PROGMEM, favorites, EQ, captive portal |
| Phase 3 — Intelligence & Advanced Features | **COMPLETE** | Analytics engine, smart shuffle, audio-reactive LEDs, ESP-NOW scaffold, DCNP colors |
| Phase 3.5 — Audit & Stability | **COMPLETE** | LED type system, theme editor fixes, dashboard caching, device preview component |
| Phase 4 — Portal Integration & Content Mgmt | **COMPLETE** | Upload/delete/reorder, DPA1 format, cover art sync, release build & push, WiFi hardening, heap optimization |
| Phase 4.5 — Vercel Cloud Backend | **COMPLETE** | Neon Postgres, Upstash Redis, Vercel Blob, Edge Config, cron jobs, live fleet dashboard, analytics pipeline, Edge Middleware |
| Phase 5 — Encryption & Security | **NOT STARTED** | `.dpa` AES-GCM containers, DUID-bound keys, content protection |
| Phase 6 — Production & Distribution | **NOT STARTED** | A2DP, OTA updates, fleet management, PCB design, manufacturing |

### Hardware architecture

- **MCU**: Waveshare ESP32-S3 Zero (dual-core 240MHz, 8MB flash, no PSRAM, ~320KB heap)
- **DAC**: Adafruit PCM5122 via I2S (GP6=BCLK, GP7=LRCLK, GP8=DOUT) — `ws_inv=true` critical
- **SD Card**: Adafruit microSD via SPI (GP10=CS, GP11=MOSI, GP12=SCK, GP13=MISO) — dual-speed: 400kHz writes, 20MHz playback
- **LEDs**: WS2812B strip on GP5 (17 LEDs) + onboard RGB on GP21
- **Buttons**: GP0=BOOT/Play, GP1=Play/Pause, GP2=Next, GP3=Prev, GP4=Heart — active LOW, INPUT_PULLUP
- **Battery**: GP9=ADC (100K/100K divider), GP14=TP4056 charge detect
- **WiFi**: AP mode (SSID=DUID e.g. "DPA-AB12", no password), dashboard at 192.168.4.1
- **Admin mode**: HEART+NEXT held 3s, or `GET /api/admin/unlock?key=<DUID>`

### Firmware file map (`firmware/dpa-esp32/`)

| File | Purpose |
|------|---------|
| `dpa-esp32.ino` | Main entry — setup/loop, buttons, battery, favorites, sync upload server (port 81), heap monitoring |
| `api.h` | REST API — status, playback, volume, EQ, favorites, LED preview, theme, WiFi, SD ops, track reorder, raw upload, CORS |
| `dpa_format.h` | DPA1 media container — v2 header parsing, metadata persistence |
| `dpa_ingest.h` | DPA ingest pipeline — capsule/content ingestion from portal |
| `platformio.ini` | PlatformIO build config for ESP32-S3 |
| `audio.h` | I2S driver, WAV parser (16/24/32-bit PCM + float32), FreeRTOS playback task (core 1), 3-band biquad EQ, seek |
| `audio_reactive.h` | Real-time audio features — peak, RMS, envelope, bass energy, beat detection |
| `led.h` | FastLED controller — 29+ patterns (base, animated, notification, audio-reactive, VU) |
| `sd_card.h` | SD card SPI manager — dual-speed mount, stats, file listing, delete, reorder |
| `dpa_wifi.h` | WiFi AP+STA manager with NVS persistence |
| `captive.h` | Captive portal DNS hijack — iOS/Android/Windows probe handling |
| `intelligence.h` | Per-track analytics, smart playlist, DUID content binding (SHA-256) |
| `espnow_mesh.h` | ESP-NOW mesh protocol — disabled, ready for multi-device sync |
| `dashboard.h` | Gzipped HTML dashboard served from PROGMEM |
| `dashboard.html` | Source HTML for the on-device dashboard UI |
| `proxy.cjs` | Node.js proxy — serves dashboard locally, proxies API to real device |

### Vercel cloud backend (`api/`)

| File | Purpose |
|------|---------|
| `internal-api.mjs` | Core serverless function — operator auth, device check-in, analytics ingestion, fleet status, firmware registry |
| `internal-api/[[...path]].mjs` | Catch-all route handler for internal API paths |
| `db.mjs` | Neon Postgres client — schema auto-creation, query helpers |
| `redis.mjs` | Upstash Redis client — device presence, session cache |
| `blob.mjs` | Vercel Blob — firmware binary storage, artwork |
| `edge-config.mjs` | Edge Config helpers — feature flags, maintenance mode, firmware pointers, portal announcements |
| `cron/fleet-health.mjs` | Cron (every 5 min) — mark stale/offline devices, expire sessions |
| `cron/analytics-rollup.mjs` | Cron (daily 3 AM) — prune old snapshots, aggregate analytics |
| `middleware.js` (root) | Edge Middleware — admin gate, maintenance mode, geo headers, announcement injection |

### Angular portal architecture

- **Entry**: `index.tsx` → bootstraps `AppComponent` with zoneless change detection + hash routing
- **Artist Portal** (`/artist/...`): Dashboard, album editor (metadata/tracks/theme/perks/pricing), fleet tracker
- **Fan Portal** (`/fan/...`): Home, album detail, capsules, marketplace, devices, settings, audio
- **Internal Portal** (`/internal/...`): Operator login, ingest management
- **Services**:
  - `data.service.ts` — Mock data via signals, localStorage persistence
  - `player.service.ts` — Playback with device command routing
  - `device-connection.service.ts` — Transport orchestrator (WiFi/BLE/NFC/USB), cloud check-in, analytics relay
  - `device-ble.service.ts` — Web Bluetooth GATT operations
  - `device-wifi.service.ts` (~1600 lines) — HTTP client for device REST API, upload queue, analytics, cloud relay
  - `device-nfc.service.ts` — Web NFC API integration
  - `crypto.service.ts` — .dpa encryption/decryption (WebCrypto)
  - `fleet.service.ts` — Live cloud fleet analytics (plays, hearts, skips, top tracks, activity feed)
  - `release-build.service.ts` — Album compile, metadata save, firmware push pipeline
  - `cart.service.ts` — Shopping cart for capsule marketplace
  - `user.service.ts` — User profile and financials
  - `internal-operator-auth.service.ts` — Operator session management
  - `private-ingest.service.ts` — Internal ingest pipeline
  - `led-notification.service.ts` — DCNP notification animations
- **Key config**: `dpa-config.ts` — bridge WebSocket URL, API base URL, internal API base URL

### Key REST API endpoints (firmware)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Full device state JSON |
| `/api/cmd?op=XX` | GET | Hex command dispatch (01=play, 02=pause, 03=next, 04=prev, 60/61=vol) |
| `/api/audio/play?file=X` | GET | Play a WAV file by path |
| `/api/audio/stop` | GET | Stop playback |
| `/api/audio/seek?ms=N` | GET | Seek to position |
| `/api/audio/tracks` | GET | List all playable tracks (.dpa primary, .wav fallback) with metadata |
| `/api/audio/features` | GET | Real-time audio features (peak, RMS, beat, bass) |
| `/api/volume?level=N` | GET | Set volume 0-100 |
| `/api/eq?preset=X` | GET | Set EQ preset (flat/bass_boost/vocal/warm/bright/loudness/r_and_b/electronic/late_night) |
| `/api/favorites/set?file=X&state=true` | GET | Set favorite state |
| `/api/led/preview?mode=X&color=X&pattern=X` | GET | Preview LED settings |
| `/api/theme` | POST | Push full theme JSON |
| `/api/wifi/scan` | GET | Scan networks (admin) |
| `/api/wifi/connect?ssid=X&pass=Y` | GET | Connect STA (admin) |
| `/api/tracks` | GET | Track metadata with ISRC, BPM, key, credits |
| `/api/tracks/reorder` | POST | Reorder track playlist (JSON array of paths) |
| `/api/capsules` | GET | DCNP capsule list |
| `/api/capsule` | POST | Push capsule to device |
| `/api/analytics` | GET | Per-track play/skip/listen stats |
| `/api/sd/files?dir=/` | GET | SD file browser (admin) |
| `/api/sd/upload?path=X` | POST | Upload file to SD (admin) |
| `/api/sd/upload-raw?path=X` | POST | Raw body upload to SD (sync server port 81) |
| `/api/sd/delete?path=X` | DELETE | Delete file from SD (admin) |
| `/api/dpa/ingest` | POST | Ingest DPA1 media container |
| `/api/album/meta` | GET | Album metadata from SD |
| `/api/booklet` | GET | Album liner notes from SD |
| `/api/art?path=X` | GET | Serves artwork (jpg/png/webp) |
| `/api/storage` | GET | SD card stats (totalMB, usedMB, freeMB, trackCount) |

**Upload server:** Dedicated synchronous WebServer on port 81 for reliable large file uploads. Uses 8KB staging buffer with 4-retry writes. Required because ESPAsyncWebServer has bugs with large multipart uploads.

### Key cloud API endpoints (Vercel)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/internal-api/health` | GET | Service health check (Postgres, Redis, Blob, Edge Config) |
| `/internal-api/operator/login` | POST | Operator session creation |
| `/internal-api/device/check-in` | POST | Device heartbeat with status + analytics |
| `/internal-api/analytics/events` | POST | Batch analytics event ingestion |
| `/internal-api/analytics/device/:duid` | GET | Per-device analytics detail |
| `/internal-api/fleet/status` | GET | All registered devices with reachability |
| `/internal-api/fleet/analytics` | GET | Fleet-wide KPIs, top tracks, activity feed |
| `/internal-api/firmware/latest` | GET | Latest stable firmware version |

### Documentation

| File | Content |
|------|---------|
| `docs/HARDWARE-WIRING.md` | Full BOM, pin assignments, wiring diagrams |
| `docs/PERFBOARD-SOLDERING-GUIDE.md` | Step-by-step 7x9cm perfboard build, 40-wire master table |
| `docs/SYSTEM-ARCHITECTURE.md` | System architecture, BLE GATT, .dpa format, ESP-NOW protocol, LED system |
| `docs/FEATURE_WIRING_MAP.md` | Feature-by-feature wiring status (mock vs live) |
| `docs/DPA_PORTAL_FIRMWARE_INTEGRATION_SPEC.md` | Portal-firmware API contract and rollout checklist |
| `docs/DEVICE_CONNECTION_MATRIX.md` | Connection method compatibility matrix |
| `docs/CAPSULE_OTA_CONTRACT.md` | Capsule OTA delivery specification |
| `docs/SESSION-REPORT.md` | Historical session reports and pain points |
| `docs/STOP-POINT-2026-04-10.md` | April 10 checkpoint with validation results |

### External reference

- DPA Bible (product documentation): https://dpa-bible-app.vercel.app/
- Live portal: https://dpa-aup-portal.vercel.app
- Enclosure: v4 3-piece production shell — 98.7 x 67.2 x 19.1mm, prototype 3D print, production aluminum CNC
- Unit cost: ~$46.75 at prototype scale
