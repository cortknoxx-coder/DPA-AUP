<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# DPA Creator & Fan Portal

The companion web portal and ESP32 firmware for DPA (Digital Playback Asset) devices, brought to you by **The DPAC** (Digital Playback Asset Consortium). One physical device holds one album in FLAC 24/96 — plus music videos, downloadable capsule perks, and a mesh network for synchronized playback across devices.

## What's Inside

```
├── firmware/              ESP32-S3 firmware (PlatformIO)
│   └── dpa-esp32/         v2.4.1 — WiFi AP, I2S DAC, SD, WS2812B, ESP-NOW mesh, captive portal
├── src/                   Angular 21 portal (Vite + Tailwind)
│   ├── pages/             Creator portal + Fan portal
│   ├── services/          BLE, WiFi, Crypto, Player, Data
│   └── components/        Shared components
└── docs/                  Hardware wiring + system architecture
    ├── HARDWARE-WIRING.md Full pin assignments, wiring diagrams, troubleshooting
    └── SYSTEM-ARCHITECTURE.md  API reference, BLE protocol, .dpa format, mesh protocol
```

## Run the Portal Locally

**Prerequisites:** Node.js 20+

```bash
npm install
npm run dev
```

Opens at `http://localhost:4200`. No API keys required.

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

See [`docs/HARDWARE-WIRING.md`](docs/HARDWARE-WIRING.md) for complete pin assignments and wiring diagrams.

## Device Connection

The portal communicates with DPA hardware via:

| Method | Technology | Use Case |
|--------|-----------|----------|
| **NFC Tap** | PN532 NDEF + Web NFC API | Instant device discovery (Android) |
| **Bluetooth LE** | ESP32 BLE GATT + Web Bluetooth | Playback control, status monitoring |
| **WiFi AP** | ESP32 SoftAP + HTTP REST | Content push, file uploads, theme configuration |
| **A2DP Source** | ESP32 Classic BT | Wireless audio to speakers/headphones |
| **ESP-NOW Mesh** | ESP32 ESP-NOW | Synchronized playback across devices |

## Key Features

**Creator Portal**
- Album management with metadata, booklet, and pricing editors
- Track upload with .dpa encryption (AES-256-GCM, device-locked)
- LED theme editor with real-time 3D device preview
- Capsule perk console (concert, video, merch, remix, signing)
- Fleet tracker for device mesh visualization

**Fan Portal**
- Album browsing with integrated audio player
- Capsule inbox with device-side download
- Audio settings (volume, EQ, playback mode)
- Bluetooth A2DP pairing for wireless speakers/headphones
- LED theme personalization
- Device registration via NFC or BLE

**Firmware**
- Hi-fi FLAC 24/96 decode via PCM5122 DAC
- Bluetooth A2DP Source for wireless audio output
- WS2812B LED strip with customizable colors and animations
- ESP-NOW mesh for multi-device sync and capsule relay
- NFC tag emulation for instant phone pairing
- Full REST API over WiFi AP

## Documentation

- [`docs/HARDWARE-WIRING.md`](docs/HARDWARE-WIRING.md) — Pin assignments, wiring diagrams, BOM, troubleshooting
- [`docs/SYSTEM-ARCHITECTURE.md`](docs/SYSTEM-ARCHITECTURE.md) — REST API, BLE GATT profile, .dpa encryption format, ESP-NOW mesh protocol, portal architecture

## Hardware

| Component | Part |
|-----------|------|
| MCU | **Waveshare ESP32-S3 Zero** (8MB flash, no PSRAM, USB-C CDC) |
| DAC | Adafruit PCM5122 (I2S, 24-bit / 32-bit, up to 384kHz) |
| LEDs | WS2812B-style addressable RGB (2.7mm pitch, SuperLightingLED) |
| Storage | Adafruit microSD breakout (SPI, ~2GB tested) |
| Controls | 4x tactile buttons (Play/Pause, Next, Prev, Heart) + BOOT |
| Battery | 3.7V LiPo with ADC monitoring + charge detect |
| Comms | BLE, WiFi SoftAP, ESP-NOW mesh, (optional) A2DP |

> **Note:** Earlier prototyping used ESP32-WROVER-32 / WROOM-32. The final hardware is the Waveshare ESP32-S3 Zero, which has a different pin map and no PSRAM. All firmware and docs in `main` target the S3 Zero. WROOM-era artifacts remain only in git history.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Firmware | Arduino ESP32 (C++), Bluedroid BLE, ESP-IDF I2S, FastLED |
| Portal | Angular 21, Vite, Tailwind CSS 4, TypeScript 5.7 |
| Encryption | AES-256-GCM (WebCrypto + mbedtls) |
| Audio | PCM5122 DAC, dr_flac decoder, A2DP SBC codec |
| Mesh | ESP-NOW (6 peers, 200-byte packets, 5s heartbeat) |
