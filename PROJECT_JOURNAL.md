# DPA Project Journal — Complete History

## Project Timeline

| Milestone | Date | Duration |
|-----------|------|----------|
| First commit (project init) | Dec 15, 2025 | — |
| Portal foundation (Angular, routes, components) | Dec 2025 – Feb 2026 | ~10 weeks |
| Firmware Phase 3 (audio, LEDs, mesh scaffold) | Feb – Mar 2026 | ~4 weeks |
| Phase 4 (portal ↔ firmware integration) | Mar – Apr 3, 2026 | ~4 weeks |
| Phase 4.5 (artwork, analytics, theme sync, perks fix) | Apr 3 – Apr 6, 2026 | 3 days |
| **Total project span** | **Dec 15, 2025 → Apr 6, 2026** | **~16 weeks** |
| **Total commits** | **99** | — |

---

## Codebase Scale

| Layer | Files | Lines of Code |
|-------|-------|---------------|
| TypeScript (portal) | 42 | ~8,100 |
| HTML (templates) | 28 | ~10,600 |
| C++ firmware (custom) | 8 | ~20,500 |
| Documentation | 23 | ~2,000+ |
| **Total** | **~100 source files** | **~41,000+ lines** |

---

## What We Completed (Phase by Phase)

### Phase 1 — Portal Foundation (Dec 2025 – Jan 2026)
- Angular 21 project scaffold with standalone components
- Routing: creator portal + fan portal with nested album routes
- Mock data service with full album/track/theme/event data
- Theme editor with 3D device mockup and LED glow CSS animations
- Fan auth flow (WiFi, BLE, NFC, USB Bridge)
- Marketplace, fleet tracker, pricing, account pages (UI shells)

### Phase 2 — Device Services (Jan – Feb 2026)
- `DeviceBleService` — Web Bluetooth GATT
- `DeviceWifiService` — full REST client for firmware API
- `DeviceNfcService` — Web NFC read/write
- `DeviceBridgeService` — USB serial communication
- `CryptoService` — AES-256-GCM encryption, DPA1 container format
- `DeviceConnectionService` — unified connection state management

### Phase 3 — Firmware (Feb – Mar 2026)
- ESP32-S3 Zero firmware: audio playback engine (FLAC 24/96 → I2S → DAC)
- 29 LED patterns in `led.h` (basic, animated, audio-reactive, VU, notification)
- ESPAsyncWebServer with 15+ REST endpoints
- WiFi SoftAP + captive portal + STA dual-mode
- SD card file system: tracks, capsules, analytics, favorites, artwork
- NVS persistence for themes, WiFi creds, device identity
- Hardware button handler (play/pause/next/prev/heart)
- Dashboard HTML embedded via `gen_dashboard.sh`
- PlatformIO build system configured

### Phase 4 — Portal ↔ Firmware Integration (Mar – Apr 3, 2026)
- **Creator upload pipeline**: WAV from browser → device SD → indexed → plays (130MB proven)
- **Synchronous upload server** on port 81 (solved ESPAsyncWebServer's fatal upload bug)
- **SPI bus contention fix**: stop async server + DNS during uploads
- **32-bit float WAV** support (audioFormat==3)
- **All creator tabs wired**: metadata, tracks, theme, perks, overview
- **Fan portal wired**: track playback, favorites, capsule inbox, LED mirror, audio controls
- **Analytics**: play counts persisted to SD, path-based matching in portal
- **Dynamic SSID**: `Artist-Album-DPA` from creator metadata
- **DPA™ branding** across all pages
- **Player bar**: live progress polling, close button, heart sync

### Phase 4.5 — Polish & Data Integrity (Apr 3–6, 2026)
- **Artwork pipeline**: cover art + per-track art upload → device `/art/` → firmware API serve
- **Mock data restored** after premature removal caused confusion
- **Auto-redirect** for stale album URLs
- **LED/theme sync**: bidirectional DCNP color pull from device on WiFi
- **Creator vs fan LED separation**: creator = perks/DCNP, fan = strip modes
- **DPA mockup always visible** on theme tab with perk glow preview
- **Shared firmware pattern catalog** (`FIRMWARE_LED_PATTERN_GROUPS`)
- **`Theme` extended**: `ledBrightness`, `ledGradEnd` match firmware NVS
- **Perks overhaul** (7 fixes):
  - Shared capsuleId (portal event ↔ device)
  - Mark delivered after successful push
  - Flat JSON body for reliable firmware parsing
  - Richer RuntimeCapsule (price, ctaLabel, ctaUrl, hasImage)
  - Proper date in capsule push
  - `videoUrl` wired (was dead code)
  - Device reconciliation via `/api/capsules` readback

---

## Pain Points & Failures (Chronological)

### 1. ESPAsyncWebServer upload bug (2 days lost)
**Problem**: Library has unfixable bugs with large multipart uploads. SPI bus contention causes SD write failures after 0.5–9.5MB.
**Attempts**: 6 different approaches (slow SD clock, persistent handle, staging buffer, WiFi sleep disable, upload flag, full server stop).
**Solution**: Dedicated synchronous WebServer on port 81 with complete network isolation during uploads.
**Lesson**: Archived libraries with known bugs cannot be worked around — use a different approach entirely.

### 2. SPI bus contention (1 day lost)
**Problem**: WiFi stack background processing disrupts SD card writes on shared SPI bus.
**Solution**: `server.end()` + `g_dnsServer.stop()` + loop early-return during uploads.
**Lesson**: On ESP32, WiFi and SD cannot safely run concurrently for sustained I/O.

### 3. XHR timeout killing 130MB uploads (hours)
**Problem**: Browser XMLHttpRequest timeout of 10 minutes. At ~45KB/s, 130MB needs ~48 minutes.
**Solution**: `xhr.timeout = 0`.
**Lesson**: Always disable timeouts for slow-link transfers.

### 4. CORS preflight blocking all browser uploads (hours)
**Problem**: Firmware returned 404 for OPTIONS requests. No upload from browser ever started.
**Solution**: Handle OPTIONS in catch-all with 204 + CORS headers.
**Lesson**: Every POST from a browser sends a preflight first.

### 5. FAT32 filename spaces (hours)
**Problem**: `ad db cort.wav` broke ESP32 SD library file operations.
**Solution**: `sanitizePath()` replaces spaces and special chars with underscores.
**Lesson**: Always sanitize filenames for embedded FAT32.

### 6. 32-bit float WAV not recognized (hours)
**Problem**: Parser only handled `audioFormat==1` (PCM integer). Production masters often use float.
**Solution**: Extended parser for `audioFormat==3`, added `audioReadFloat32le()` conversion.
**Lesson**: Real-world audio files use more formats than textbook examples.

### 7. Mock data removal broke everything (1 session)
**Problem**: Removed all demo data at once, user lost visual context and bookmarks broke.
**Solution**: Reverted mock data, added auto-redirect for stale URLs, adopted incremental replacement strategy.
**Lesson**: Never rip out scaffolding before replacements are in place.

### 8. Nested JSON parsing on firmware (subtle, found late)
**Problem**: `pushCapsule()` sent `{ eventType, capsuleId, payload: { title, ... } }`. Firmware's `jsonVal` scans flat keys — `title` found by accident of key ordering.
**Solution**: Flatten to top-level keys. Firmware parses reliably.
**Lesson**: Constrained parsers need flat data structures.

### 9. `escJson` forward declaration missing (build break)
**Problem**: `capsulesSave()` called `escJson()` which was defined later in the file.
**Solution**: Added forward declaration.
**Lesson**: C++ header-only files need careful ordering or forward declarations.

### 10. `pio` not on macOS PATH (repeated friction)
**Problem**: Every new terminal tab lost the PATH to PlatformIO binaries.
**Solution**: `echo 'export PATH...' >> ~/.zshrc`.
**Lesson**: Always make toolchain paths permanent.

---

## Successes & Breakthroughs

| Achievement | Significance |
|---|---|
| **130MB WAV upload over ESP32 AP WiFi** | Proved the entire creator-to-device pipeline works for real production masters |
| **29 LED patterns including audio-reactive VU** | Full visual experience controlled from both portal and hardware buttons |
| **Flat capsule protocol with delivery tracking** | Reliable perk push from creator → device with status reconciliation |
| **Artwork pipeline (portal → SD → API → display)** | Cover art and per-track art flow end-to-end from upload to device dashboard |
| **Bidirectional theme sync** | Portal reads device state AND pushes changes, with quiet persistence |
| **DPA1 audio container format** | Custom encrypted media format designed and implemented (encryption phase pending) |
| **Dual web server architecture** | Solved an "unsolvable" library limitation with creative engineering |
| **Dynamic WiFi SSID from metadata** | Device identity broadcasts artist+album automatically |
| **Creator/fan portal separation** | Clean role split: creators manage perks and metadata, fans tune their device |

---

## Key Learnings

### Embedded / Hardware
1. SPI bus arbitration is the biggest reliability risk on ESP32
2. Archived libraries (ESPAsyncWebServer) can have unfixable bugs — always have a Plan B
3. Always test with real production audio files, not just samples
4. NVS is cheap and reliable for settings; SD is necessary for content
5. `FastLED.setBrightness()` must be called every frame to avoid stale DMA data

### Web / Frontend
6. Signal-based Angular (v21) is significantly cleaner than Observable-heavy patterns
7. `localStorage` is viable for creator-side state before a backend exists
8. Never remove mock data all at once — replace incrementally
9. `debounceTime` is essential for live device preview (prevent flooding REST API)
10. CSS `--glow-color` variables make dynamic LED preview animations elegant

### Integration / Protocol
11. Firmware JSON parsers should accept flat top-level keys only
12. Shared IDs between systems must be generated once and passed everywhere
13. CORS is non-optional — every browser request sends OPTIONS first
14. Reconciliation (readback from device) is essential for delivery status
15. Port separation (80 for API, 81 for uploads) is a clean architectural pattern

### Process
16. Commit often with descriptive messages — 99 commits tells a clear story
17. `FEATURE_WIRING_MAP.md` was invaluable for tracking what's real vs mock
18. `SESSION-REPORT.md` captures decisions and pain points before you forget them
19. `QUICKSTART.md` saves 10 minutes every session
20. Always include terminal output when reporting back — it builds trust and catches issues

---

## What's Still Pending

### Near-term
- [ ] Test full capsule push flow on hardware with latest firmware
- [ ] Wire remaining EMPTY fields (booklet, pricing, account)
- [ ] Capsule read state in fan portal
- [ ] Storage budget display in creator portal

### Phase 5 — Security
- [ ] `.dpa` AES-GCM encryption bound to device DUID
- [ ] Secure content at rest on SD
- [ ] Device authentication / DUID verification

### Phase 6 — Production
- [ ] A2DP Bluetooth audio output
- [ ] OTA firmware updates
- [ ] USB Mass Storage firmware for manufacturing
- [ ] Fleet management with real telemetry
- [ ] PWA packaging for fan portal
- [ ] Payment gateway integration
- [ ] Backend API (replace localStorage)

---

## Stats at a Glance

| Metric | Value |
|--------|-------|
| Project duration | ~16 weeks |
| Total commits | 99 |
| Lines of code | ~41,000+ |
| Source files | ~100 |
| REST API endpoints | 15+ |
| LED patterns | 29 |
| Audio formats supported | 6 (16/24/32-bit PCM, 32-bit float, packed 24, DPA1) |
| Capsule event types | 6 |
| Portal pages/views | 18+ |
| Major pain points overcome | 10 |
| Firmware build failures fixed | 9+ |
| Hardware-validated features | 15 |
