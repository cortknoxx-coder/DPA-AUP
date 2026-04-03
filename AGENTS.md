# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

**DPA (Digital Playback Asset)** — a hardware device + software platform for physical music ownership. Built by The DPAC (Digital Playback Asset Consortium).

This repo (`DPA-AUP`) contains two major parts:

1. **Angular 21 Portal** (root `src/`, `index.tsx`) — Creator & Fan web app
2. **ESP32-S3 Firmware** (`firmware/dpa-esp32/`) — Device firmware in Arduino/C++

The Angular app runs standalone with mock data (no backend needed). The firmware runs on a Waveshare ESP32-S3 Zero with PCM5122 DAC, microSD, WS2812B LEDs, and hardware buttons.

### Dev commands

| Action | Command |
|--------|---------|
| Install deps | `npm install --legacy-peer-deps` |
| Dev server | `npm run dev` (serves on port 3000) |
| Production build | `npm run build` |

### Non-obvious caveats

- **`--legacy-peer-deps` required**: Angular 21 requires TypeScript >=5.9 but `package.json` pins `~5.8.2`. Use `npm install --legacy-peer-deps` to avoid `ERESOLVE` peer-dependency conflicts.
- **No lint or test scripts**: The repo has no ESLint config or test framework configured. `package.json` only defines `dev`, `build`, and `preview` scripts.
- **No `.env` needed**: The README mentions `GEMINI_API_KEY` in `.env.local`, but no code references it. The app runs fully without any environment variables.
- **Simulator mode**: The app references a WebSocket bridge (`ws://localhost:8787`) and a REST API (`http://localhost:8080/api/v1`) in `dpa-config.ts`, but gracefully falls back to simulator/mock mode when these are unavailable.
- **ESP32 mock server**: `.claude/launch.json` contains a Node.js mock server config (`esp32-dash`) on port 4300 that simulates all firmware REST API endpoints for dashboard development without real hardware.
- **Dashboard proxy**: `firmware/dpa-esp32/proxy.cjs` proxies `/api/*` to a real device at `192.168.4.1` while serving `dashboard.html` locally (port 4301).

### Project status (as of April 2026)

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1 — Hardware & Firmware Foundation | **COMPLETE** | ESP32 firmware, I2S audio, SD WAV playback, 29 LED patterns, buttons, battery |
| Phase 2 — Dashboard & Web API | **COMPLETE** | REST API (`api.h`), gzipped dashboard from PROGMEM, favorites, EQ, captive portal |
| Phase 3 — Intelligence & Advanced Features | **COMPLETE** | Analytics engine, smart shuffle, audio-reactive LEDs, ESP-NOW scaffold, DCNP colors |
| Phase 3.5 — Audit & Stability | **COMPLETE** | LED type system, theme editor fixes, dashboard caching, device preview component |
| Phase 4 — Fan/Creator Portal Integration | **NOT STARTED** | Wire Angular portal to live device via WiFi/BLE/NFC |
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
| `dpa-esp32.ino` | Main entry — setup/loop, button handling, battery, track scanning, favorites |
| `api.h` | REST API — status, playback, volume, EQ, favorites, LED preview, theme, WiFi, SD ops |
| `audio.h` | I2S driver, WAV parser, FreeRTOS playback task (core 1), 3-band biquad EQ, seek |
| `audio_reactive.h` | Real-time audio features — peak, RMS, envelope, bass energy, beat detection |
| `led.h` | FastLED controller — 29 patterns (base, animated, notification, audio-reactive, VU) |
| `sd_card.h` | SD card SPI manager — dual-speed mount, stats, file listing |
| `dpa_wifi.h` | WiFi AP+STA manager with NVS persistence |
| `captive.h` | Captive portal DNS hijack — iOS/Android/Windows probe handling |
| `intelligence.h` | Per-track analytics, smart playlist, DUID content binding (SHA-256) |
| `espnow_mesh.h` | ESP-NOW mesh protocol — disabled, ready for multi-device sync |
| `dashboard.h` | Gzipped HTML dashboard served from PROGMEM |
| `dashboard.html` | Source HTML for the on-device dashboard UI |
| `proxy.cjs` | Node.js proxy — serves dashboard locally, proxies API to real device |

### Angular portal architecture

- **Entry**: `index.tsx` → bootstraps `AppComponent` with zoneless change detection + hash routing
- **Artist Portal** (`/artist/...`): Dashboard, album editor (metadata/tracks/theme/perks/pricing), fleet tracker
- **Fan Portal** (`/fan/...`): Home, album detail, capsules, marketplace, devices, settings, audio
- **Services**: `data.service.ts` (mock data via signals), `player.service.ts`, `device-connection.service.ts`, `device-ble.service.ts`, `device-wifi.service.ts`, `device-nfc.service.ts`, `crypto.service.ts`, `cart.service.ts`, `fleet.service.ts`, `led-notification.service.ts`, `user.service.ts`
- **Key config**: `dpa-config.ts` — bridge WebSocket URL, API base URL

### Key REST API endpoints (firmware)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Full device state JSON |
| `/api/cmd?op=XX` | GET | Hex command dispatch (01=play, 02=pause, 03=next, 04=prev, 60/61=vol) |
| `/api/audio/play?file=X` | GET | Play a WAV file by path |
| `/api/audio/stop` | GET | Stop playback |
| `/api/audio/seek?ms=N` | GET | Seek to position |
| `/api/audio/wavs` | GET | List all valid WAV files with metadata |
| `/api/audio/features` | GET | Real-time audio features (peak, RMS, beat, bass) |
| `/api/volume?level=N` | GET | Set volume 0-100 |
| `/api/eq?preset=X` | GET | Set EQ preset (flat/bass_boost/vocal/warm/bright/loudness/r_and_b/electronic/late_night) |
| `/api/favorites/set?file=X&state=true` | GET | Set favorite state |
| `/api/led/preview?mode=X&color=X&pattern=X` | GET | Preview LED settings |
| `/api/theme` | POST | Push full theme JSON |
| `/api/wifi/scan` | GET | Scan networks (admin) |
| `/api/wifi/connect?ssid=X&pass=Y` | GET | Connect STA (admin) |
| `/api/tracks` | GET | Track metadata with ISRC, BPM, key, credits |
| `/api/capsules` | GET | DCNP capsule list |
| `/api/analytics` | GET | Per-track play/skip/listen stats |
| `/api/sd/files?dir=/` | GET | SD file browser (admin) |
| `/api/sd/upload?path=X` | POST | Upload file to SD (admin) |

### Documentation

| File | Content |
|------|---------|
| `docs/HARDWARE-WIRING.md` | Full BOM, pin assignments, wiring diagrams (ESP32-WROVER-32 variant) |
| `docs/PERFBOARD-SOLDERING-GUIDE.md` | Step-by-step 7x9cm perfboard build, 40-wire master table |
| `docs/SYSTEM-ARCHITECTURE.md` | System architecture, BLE GATT, .dpa format, ESP-NOW protocol, LED system |

### External reference

- DPA Bible (product documentation): https://dpa-bible-app.vercel.app/
- Enclosure: v4 3-piece production shell — 98.7 x 67.2 x 19.1mm, prototype 3D print, production aluminum CNC
- Unit cost: ~$46.75 at prototype scale
