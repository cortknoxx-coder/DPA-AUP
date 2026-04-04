# DPA Development Session Report

## Date: April 3-4, 2026

## Overview

This session covered environment setup, portal-firmware integration, DPA audio format definition, and end-to-end creator upload pipeline validation — culminating in a successful 130MB 32-bit float WAV upload from the browser to the ESP32-S3 device over WiFi, with live playback through the PCM5122 DAC.

---

## Major Accomplishments

### 1. Development Environment Setup
- Angular 21 portal running on localhost:3000
- PlatformIO firmware build system configured for ESP32-S3 Zero
- Mock firmware API server for offline portal development
- Both portal and firmware compile cleanly

### 2. Portal-Firmware Integration (Phase 4 — Complete)
- Wired `DeviceWifiService` to all firmware REST API endpoints
- Fan portal tracks, capsules, analytics, favorites all read from live device
- Creator theme editor pushes to device LED/theme in real-time
- Creator perks console pushes capsules to device
- Player bar shows live track info with progress polling from `/api/status`
- WiFi Direct connection flow with inline error handling
- NFC tag read/write integration (Web NFC API)

### 3. DPA Audio Format v1
- Defined `DPA1` container header (220-byte fixed header + WAV payload)
- Portal-side packager: `CryptoService.packageWavAsDpa()`
- Firmware-side parser: `dpaReadHeader()`, `audioParseDpa()`
- Neutral track listing API: `GET /api/audio/tracks`
- Legacy WAV fallback preserved throughout

### 4. Creator Upload Pipeline — Working End-to-End
- Creator uploads WAV from browser → device stores on SD → firmware indexes → device plays
- Successfully uploaded and played a **130MB 32-bit float 88.2kHz stereo WAV** over WiFi
- Upload speed: ~45KB/s over ESP32 soft AP

### 5. Audio Format Support
- 16-bit PCM (mono/stereo)
- 24-bit PCM packed (mono/stereo)
- 24-bit in 32-bit container (mono/stereo)
- 32-bit PCM integer (mono/stereo)
- **32-bit IEEE float** (mono/stereo) — added this session
- Sample rates: 44.1kHz, 48kHz, 88.2kHz, 96kHz all supported

### 6. UX Improvements
- Player bar close button (X) to dismiss
- Player bar no longer overlaps bottom page content
- Fan Home shows device tracks under "On Device Storage"
- Album detail works for firmware-only albums (no DataService match needed)
- Album naming uses creator metadata instead of device DUID
- DPA™ branding added across all portal pages
- Connection flow routes to options page instead of forcing USB bridge
- Inline error banners replace all blocking `alert()` popups

### 7. Creator Metadata Persistence
- `DataService` now hydrates from / saves to `localStorage`
- Album title, artist, theme, booklet, pricing, tracks all survive page refresh

### 8. Firmware Improvements
- AP SSID hardcoded to "DPA-Portal"
- Capsule ingest API (`POST /api/capsule`)
- Analytics API (`GET /api/analytics`)
- LED brightness and gradient end color in status JSON
- Filename sanitization for FAT32 SD compatibility
- Generic track scanner: `.dpa` first, `.wav` fallback
- CORS preflight handling (OPTIONS → 204)

---

## Pain Points & Hurdles

### 1. ESPAsyncWebServer Cannot Handle Large File Uploads
**Problem**: The async web server library (archived, no longer maintained) has fundamental issues with large multipart uploads. The async TCP stack's background processing contends with SPI bus access to the SD card, causing `ff_sd_status(): Check status failed` errors after 0.5-9.5MB of writes.

**Resolution**: Added a **separate synchronous WebServer on port 81** specifically for file uploads, modeled directly on the working DPAC uploader tool. The async server on port 80 continues handling dashboard, API, and captive portal.

### 2. SPI Bus Contention Between WiFi and SD Card
**Problem**: The ESP32-S3's WiFi stack and SD card share underlying bus resources. Background network processing (DNS queries, async TCP housekeeping, captive portal probes) disrupts sustained SD writes.

**Resolution** (iterative, 6 attempts):
1. ~~Slow SD clock for writes~~ — helped but insufficient
2. ~~Persistent file handle~~ — eliminated open/close per chunk but SPI still dropped
3. ~~8KB staging buffer with 4-retry writes~~ — matched DPAC uploader pattern
4. ~~`WiFi.setSleep(false)`~~ — prevented power management interference
5. ~~`g_uploadInProgress` flag to skip background tasks~~ — reduced contention
6. **Stop async server AND DNS server during uploads + dedicated loop** — this finally worked

The key insight: the async server's background TCP processing must be **completely stopped** during uploads, not just paused. `server.end()` + `g_dnsServer.stop()` + loop early-return gave the sync upload server exclusive CPU and SPI access.

### 3. XHR Timeout Killing Uploads
**Problem**: The browser's XMLHttpRequest timeout was set to 10 minutes (600,000ms). At ~45KB/s over the ESP32 soft AP, a 130MB file needs ~48 minutes. The browser aborted the connection at exactly the timeout boundary.

**Resolution**: Set `xhr.timeout = 0` (no timeout). The upload now runs as long as needed.

### 4. CORS Preflight Blocking All Browser Uploads
**Problem**: Every browser upload sends an OPTIONS preflight request before the actual POST. The firmware's `onNotFound` handler returned 404 for OPTIONS, so no upload from the browser ever started.

**Resolution**: Added OPTIONS handling in the catch-all: returns 204 with CORS headers already set by `DefaultHeaders`.

### 5. Spaces in Filenames Break FAT32 SD Library
**Problem**: Files like `ad db cort.wav` created `.part` temp files with spaces that the ESP32 SD library couldn't reliably open/close.

**Resolution**: Added `sanitizePath()` function that replaces spaces, parentheses, apostrophes, ampersands, and hash symbols with underscores before any file operation.

### 6. 32-bit Float WAV Not Recognized
**Problem**: Uploaded WAV file was 32-bit IEEE float (audioFormat == 3). The firmware parser only accepted audioFormat == 1 (PCM integer), so the file was on the SD but invisible to the track scanner.

**Resolution**: Extended the WAV parser to accept audioFormat == 3, and added a `audioReadFloat32le()` conversion function that clamps float samples to [-1.0, 1.0] and converts to int32 for the I2S DAC.

### 7. Port 81 URL Rewrite Fragility
**Problem**: The portal's regex to rewrite the base URL from port 80 to port 81 failed when the URL had a trailing slash or no explicit port.

**Resolution**: Replaced fragile regex with explicit host extraction: strip protocol and port, then append `:81`.

### 8. Leftover `.part` Files Blocking Uploads
**Problem**: Failed uploads left `.part` temp files on the SD. Subsequent uploads with the same sanitized filename couldn't rename because the old `.part` (with spaces) didn't match the new sanitized path.

**Resolution**: Firmware now deletes both the `.part` and final path at upload start. Users can also delete stale files via the admin SD file browser API.

---

## Architecture Decisions

### Two Web Servers
- **Port 80**: ESPAsyncWebServer — dashboard, REST API, captive portal, LED control, playback
- **Port 81**: Synchronous WebServer — file uploads only

This split exists because ESPAsyncWebServer has unfixable bugs with large file uploads (library is archived). The sync server matches the proven DPAC uploader pattern.

### Upload Strategy
- WiFi uploads for: metadata, themes, capsules, images (<12KB)
- WiFi uploads for: audio masters (proven up to 130MB, ~45KB/s)
- Future: USB Mass Storage firmware for manufacturing (drag-and-drop, no WiFi)
- Future: USB-C serial protocol for production upload path

### DPA Audio Format
- DPA1 container wraps WAV payload with metadata header
- Firmware scans `.dpa` first, falls back to `.wav`
- Portal packages uploads as DPA1 (currently disabled — uploads raw WAV for reliability)
- DPA1 encryption reserved for Phase 5

### Creator Metadata
- Stored in browser `localStorage` (no backend)
- Mock data seeds on first load, persists after edits
- Creator track list shows both local metadata and device-sourced tracks

---

## What's Working (Validated on Hardware)

| Feature | Status | Evidence |
|---------|--------|----------|
| Firmware boot + SD mount | ✅ | Serial log: 5 tracks found |
| WiFi AP (DPA-Portal) | ✅ | Phone/Mac connects, captive portal works |
| Audio playback (24-bit PCM) | ✅ | 4 tracks play through DAC |
| Audio playback (32-bit float) | ✅ | STAYOUTTHEWAY.wav plays correctly |
| LED patterns (29 patterns) | ✅ | Real-time control from portal |
| Hardware buttons | ✅ | Play/pause/next/prev/heart all work |
| Favorites system | ✅ | Heart button + portal sync |
| Creator portal WiFi connect | ✅ | LIVE status in top-right |
| Creator track upload (130MB) | ✅ | File on SD, indexed, plays |
| Fan portal track listing | ✅ | Shows device tracks over WiFi |
| Player bar with live progress | ✅ | Polls `/api/status` every 1.5s |
| Theme push to device | ✅ | LED colors change in real-time |
| Capsule push to device | ✅ | Creator perks → device |
| NFC tag write/read | ⚠️ | Code complete, hardware not tested |
| BLE GATT | ❌ | Parked — no firmware GATT service |

---

## What's Next

### Immediate
1. Remove mock data from creator Tracks tab — show device tracks only
2. Add play/preview button to creator track rows
3. Wire remaining creator portal tabs end-to-end
4. Add capsule unread/read state in fan portal

### Short-term
1. USB Mass Storage firmware for manufacturing
2. Enforce 24-bit/96kHz + 15-track limit for production
3. Storage budget display in creator portal
4. Track deletion from portal

### Phase 5 — Encryption & Security
1. `.dpa` AES-GCM encryption bound to device DUID
2. Secure content delivery (encrypted at rest on SD)
3. Device authentication / DUID verification

### Phase 6 — Production
1. A2DP Bluetooth audio output
2. OTA firmware updates
3. Fleet management
4. Manufacturing provisioning flow
5. PWA packaging for fan portal

---

## Key Files Changed This Session

### Portal (Angular)
| File | Changes |
|------|---------|
| `src/services/data.service.ts` | localStorage persistence |
| `src/services/crypto.service.ts` | DPA1 packager + WAV inspector |
| `src/services/device-wifi.service.ts` | Port 81 upload, neutral track API, no timeout |
| `src/services/device-connection.service.ts` | WiFi/BLE error handling, album naming |
| `src/services/device-nfc.service.ts` | NFC write for tag provisioning |
| `src/services/player.service.ts` | WiFi polling, stop method |
| `src/pages/track-list/track-list.component.ts` | Direct WAV upload to device |
| `src/pages/fan-portal/fan-home.component.*` | Device track list, connection options |
| `src/pages/fan-portal/fan-layout.component.html` | Player close button, padding fix |
| `src/pages/fan-portal/fan-album-detail.component.*` | Firmware album fallback |
| `src/pages/fan-portal/fan-device-registration.component.*` | LED mirror, NFC button |
| `src/pages/fan-portal/fan-audio.component.ts` | Remove min-h-screen |
| `src/types.ts` | DPA types, DeviceTrack format field |
| `src/app.component.html` | DPA™ branding |

### Firmware (ESP32-S3)
| File | Changes |
|------|---------|
| `dpa-esp32.ino` | Sync upload server, WiFi sleep, upload isolation, float WAV |
| `api.h` | Filename sanitization, CORS, neutral track API, buffered upload |
| `audio.h` | Generic track parser, DPA1 parser, 32-bit float support |
| `dpa_format.h` | DPA1 container header definition (new) |
| `dpa_wifi.h` | AP SSID hardcode |
| `dashboard.html` | Neutral track loading, stop button |

---

## Commit History (This Session)

```
5252e53 Add 32-bit float WAV support
f264d85 Remove XHR timeout for uploads
8703ccf Total network isolation during upload
732cb5f Stop async server during uploads
f6e7192 Add synchronous upload server on port 81
78bce4f Fix SD bus contention
625dcf0 Port DPAC uploader pattern
0312146 Sanitize upload filenames
8958c3c Upload WAV directly to device
fc81f4d Fix CORS preflight for uploads
2f0d52b Use upload-raw endpoint
8b526f3 Add DPA1 media layer with metadata persistence
ced88b3 Fix DPA upload indexing and reliable SD write
cc59e21 Add ™ to DPA branding
5e767a3 Fix album naming
b32d330 Fix player bar: live progress polling
991ff44 Wire NFC
0f608e6 Fix device tracks visibility
c2774e9 Fix player bar overlapping content
7fbe8bf Add close button to player bar
3392e6c Polish fan connection flow
```

---

## Lessons Learned

1. **ESPAsyncWebServer is not suitable for large file uploads** — use synchronous WebServer for any sustained I/O
2. **SPI bus contention is the #1 reliability killer** on ESP32 when WiFi and SD are both active — stop ALL background network processing during writes
3. **Browser XHR timeouts must be disabled** for ESP32 AP uploads — the throughput is ~45KB/s, not broadband
4. **CORS preflight must be handled explicitly** — the ESP32's catch-all handler will eat OPTIONS requests
5. **FAT32 filenames can't have spaces** reliably on the ESP32 SD library — sanitize everything
6. **32-bit float WAV is common in production audio** — don't assume all WAVs are PCM integer
7. **The DPAC uploader pattern works** — synchronous server, persistent file handle, 8KB staging buffer, 4-retry writes, no background tasks
