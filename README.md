<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# DPA Creator & Fan Portal

The companion web portal, Vercel cloud backend, and ESP32 firmware for DPA (Digital Playback Asset) devices, brought to you by **The DPAC** (Digital Playback Asset Consortium). One physical device holds one album — plus music videos, downloadable capsule perks, and a mesh network for synchronized playback across devices.

**Live portal:** [dpa-aup-portal.vercel.app](https://dpa-aup-portal.vercel.app)
**Product bible:** [dpa-bible-app.vercel.app](https://dpa-bible-app.vercel.app/)

## What's Inside

```
├── firmware/              ESP32-S3 firmware (PlatformIO)
│   └── dpa-esp32/         WiFi AP, I2S DAC, SD, WS2812B, ESP-NOW mesh, captive portal
├── src/                   Angular 21 portal (Vite + Tailwind)
│   ├── pages/             Creator portal + Fan portal
│   ├── services/          WiFi, BLE, Crypto, Player, Fleet, Release Build
│   └── components/        Shared components
├── api/                   Vercel serverless functions (cloud backend)
│   ├── internal-api.mjs   Core API: auth, device check-in, analytics, fleet, firmware
│   ├── cron/              Scheduled jobs (fleet health, analytics rollup)
│   ├── db.mjs             Neon Postgres client
│   ├── redis.mjs          Upstash Redis client
│   ├── blob.mjs           Vercel Blob storage
│   └── edge-config.mjs    Vercel Edge Config (feature flags, maintenance)
├── middleware.js           Vercel Edge Middleware (admin gate, maintenance, geo headers)
├── scripts/               Dev/test utilities
└── docs/                  Hardware wiring, system architecture, integration specs
```

## Run the Portal Locally

**Prerequisites:** Node.js 20+

```bash
npm install --legacy-peer-deps
npm run dev
```

Opens at `http://localhost:3000`. No API keys required for local development — cloud features activate automatically when deployed to Vercel with environment variables.

## Flash the Firmware

**Prerequisites:** [PlatformIO Core](https://platformio.org/install/cli) (installs the ESP32-S3 toolchain automatically)

```bash
cd firmware/dpa-esp32
./gen_dashboard.sh        # regenerates dashboard.h from dashboard.html
pio run                   # build
pio run --target upload   # flash over USB-C
pio device monitor -b 115200
```

Hardware: **Waveshare ESP32-S3 Zero** (8MB flash, no PSRAM). USB-C serial is CDC-on-boot; no external UART chip. See [`docs/HARDWARE-WIRING.md`](docs/HARDWARE-WIRING.md) for the full pin map.

## Device Connection

The portal communicates with DPA hardware via:

| Method | Technology | Use Case |
|--------|-----------|----------|
| **WiFi AP** | ESP32 SoftAP + HTTP REST | Content push, file uploads, theme configuration, playback |
| **NFC Tap** | PN532 NDEF + Web NFC API | Instant device discovery (Android) |
| **Bluetooth LE** | ESP32 BLE GATT + Web Bluetooth | Playback control, status monitoring |
| **A2DP Source** | ESP32 Classic BT | Wireless audio to speakers/headphones |
| **ESP-NOW Mesh** | ESP32 ESP-NOW | Synchronized playback across devices |

## Key Features

**Creator Portal**
- Album management with metadata, booklet, and pricing editors
- Track upload/delete/reorder with drag-and-drop playlist management
- Release compile & push: build album packages and deploy to device
- LED theme editor with real-time 3D device preview
- Capsule perk console (concert, video, merch, remix, signing)
- Fleet tracker with live cloud analytics dashboard (plays, hearts, skips, listen time)
- Cover art upload and sync to device

**Fan Portal**
- Album browsing with integrated audio player
- Capsule inbox with device-side download
- Audio settings (volume, EQ, playback mode)
- Bluetooth A2DP pairing for wireless speakers/headphones
- LED theme personalization
- Device registration via NFC or BLE

**Firmware**
- Hi-fi WAV playback (16/24/32-bit, up to 96kHz) via PCM5122 DAC
- DPA1 media container format with metadata header
- WS2812B LED strip with 29+ patterns (base, animated, audio-reactive, VU meter)
- Hardware button controls with debounce and long-press
- Full REST API over WiFi AP with admin gating
- Dedicated upload server (port 81) for reliable large file transfers
- Per-track analytics (play count, skip count, listen time, favorites)
- Heap-safe operation with configurable WiFi maintenance windows

**Vercel Cloud Backend**
- Neon Postgres: device registry, analytics events, operator sessions, firmware versions
- Upstash Redis: real-time device presence, session cache, rate limiting
- Vercel Blob: firmware binary storage, artwork assets
- Vercel Edge Config: feature flags, maintenance mode, firmware pointers
- Cron jobs: fleet health checks (every 5 min), analytics rollup (daily 3 AM)
- Edge Middleware: admin auth gate, maintenance mode, geo headers, announcements

## Documentation

- [`docs/HARDWARE-WIRING.md`](docs/HARDWARE-WIRING.md) — Pin assignments, wiring diagrams, BOM, troubleshooting
- [`docs/SYSTEM-ARCHITECTURE.md`](docs/SYSTEM-ARCHITECTURE.md) — REST API, BLE GATT profile, .dpa encryption format, ESP-NOW mesh protocol
- [`docs/FEATURE_WIRING_MAP.md`](docs/FEATURE_WIRING_MAP.md) — Feature-by-feature wiring status (mock vs live data)
- [`docs/DPA_PORTAL_FIRMWARE_INTEGRATION_SPEC.md`](docs/DPA_PORTAL_FIRMWARE_INTEGRATION_SPEC.md) — Portal-firmware API contract
- [`docs/DEVICE_CONNECTION_MATRIX.md`](docs/DEVICE_CONNECTION_MATRIX.md) — Connection method compatibility matrix
- [`docs/CAPSULE_OTA_CONTRACT.md`](docs/CAPSULE_OTA_CONTRACT.md) — Capsule OTA delivery specification

## Hardware

| Component | Part |
|-----------|------|
| MCU | **Waveshare ESP32-S3 Zero** (8MB flash, no PSRAM, USB-C CDC) |
| DAC | Adafruit PCM5122 (I2S, 24-bit / 32-bit, up to 384kHz) |
| LEDs | WS2812B-style addressable RGB (17 LEDs, GP5) + onboard RGB (GP21) |
| Storage | Adafruit microSD breakout (SPI, dual-speed: 400kHz writes, 20MHz playback) |
| Controls | 4x tactile buttons (Play/Pause, Next, Prev, Heart) + BOOT |
| Battery | 3.7V LiPo with ADC monitoring (GP9) + TP4056 charge detect (GP14) |
| Comms | BLE, WiFi SoftAP, ESP-NOW mesh, (optional) A2DP |

> **Note:** Earlier prototyping used ESP32-WROVER-32 / WROOM-32. The final hardware is the Waveshare ESP32-S3 Zero, which has a different pin map and no PSRAM. All firmware and docs in `main` target the S3 Zero.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Firmware | Arduino ESP32 (C++), ESP-IDF I2S, FastLED, dual WebServer |
| Portal | Angular 21, Vite, Tailwind CSS 4, TypeScript 5.9 |
| Cloud Backend | Vercel Serverless Functions, Edge Middleware |
| Database | Neon Postgres (serverless), Upstash Redis |
| Storage | Vercel Blob, Vercel Edge Config |
| Encryption | AES-256-GCM (WebCrypto + mbedtls) |
| Audio | PCM5122 DAC, WAV parser (16/24/32-bit PCM + float32) |
| Mesh | ESP-NOW (6 peers, 200-byte packets, 5s heartbeat) |

## Project Status (April 2026)

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1 — Hardware & Firmware Foundation | **COMPLETE** | ESP32 firmware, I2S audio, SD WAV playback, 29 LED patterns, buttons, battery |
| Phase 2 — Dashboard & Web API | **COMPLETE** | REST API, gzipped dashboard from PROGMEM, favorites, EQ, captive portal |
| Phase 3 — Intelligence & Advanced Features | **COMPLETE** | Analytics engine, smart shuffle, audio-reactive LEDs, ESP-NOW scaffold |
| Phase 3.5 — Audit & Stability | **COMPLETE** | LED type system, theme editor fixes, dashboard caching, device preview |
| Phase 4 — Portal Integration & Content Mgmt | **COMPLETE** | Upload/delete/reorder, DPA1 format, cover art sync, release build, WiFi hardening |
| Phase 4.5 — Vercel Cloud Backend | **COMPLETE** | Neon Postgres, Upstash Redis, Vercel Blob, Edge Config, cron jobs, live fleet dashboard, analytics pipeline |
| Phase 5 — Encryption & Security | **NOT STARTED** | `.dpa` AES-GCM containers, DUID-bound keys, content protection |
| Phase 6 — Production & Distribution | **NOT STARTED** | A2DP, OTA updates, fleet management, PCB design, manufacturing |
