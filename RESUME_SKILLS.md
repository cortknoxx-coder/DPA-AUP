# Cortland Knox — Technical Resume

**Full-Stack IoT Engineer | Embedded Systems | Web Platforms | Audio Technology**

---

## Professional Summary

Full-stack engineer with hands-on experience designing, building, and shipping a physical consumer electronics product end-to-end — from ESP32 firmware and hardware integration to a modern Angular web portal. Proven ability to bridge embedded systems and web technologies, delivering real-time device control, audio playback, LED visualization, encrypted content delivery, and mesh networking across a unified platform.

---

## Core Technical Competencies

### Embedded Systems & Firmware
- ESP32-S3 firmware development in C++ (Arduino / ESP-IDF hybrid)
- PlatformIO build, flash, and serial debug toolchain
- I2S audio pipeline: FLAC 24/96 decode through PCM5122 DAC
- FastLED strip programming: 29 patterns including audio-reactive VU meters and notification sequences
- Non-Volatile Storage (NVS) for persistent settings across reboots
- SD card file system: JSON capsule store, artwork serving, track analytics
- REST API design on constrained microcontroller (ESPAsyncWebServer)
- WiFi dual-mode (SoftAP + STA) for device hosting and home network bridging
- Bluetooth A2DP Source for wireless audio to speakers and headphones
- ESP-NOW mesh protocol for multi-device synchronized playback
- NFC (PN532) tag emulation for instant mobile pairing

### Frontend & Web Application Development
- Angular 21: zoneless, signal-based architecture, standalone components
- TypeScript: strict interfaces across firmware communication types, UI state, and data models
- RxJS reactive programming: debounced live device preview, subscription lifecycle management
- Reactive forms with type-specific validation and payload construction
- Tailwind CSS 4: dark-theme responsive UI with glassmorphism, micro-animations, and 3D CSS transforms
- Custom CSS keyframe animations tied to real-time device state
- File upload pipelines: base64 encoding, FileReader, XMLHttpRequest binary transfers

### API Design & Systems Integration
- Designed and implemented 15+ REST endpoints for device control, content push, and telemetry
- Flat JSON serialization optimized for constrained firmware parsers
- Bidirectional sync: portal pulls device state, device accepts portal pushes
- CORS configuration for cross-origin browser-to-device communication
- Idempotent upsert patterns for capsule and theme data
- Payload validation with size caps for device memory constraints
- Forward/backward compatible field resolution with fallback keys

### Data Architecture & State Management
- Signal-based state management with localStorage persistence
- Quiet vs rebuild-triggering update patterns for theme and metadata
- Shared identifier system linking portal events to device-stored capsules
- Device reconciliation: on-connect readback of `/api/capsules` to update delivery status
- Analytics pipeline: play count accumulation by track path with firmware-portal sync

### DevOps & Developer Experience
- Git feature-branch workflow with descriptive atomic commits
- GitHub pull request management and code review collaboration
- Cross-platform build systems: Angular CLI, PlatformIO, shell script tooling
- Developer documentation: quickstart guides, feature wiring maps, system architecture specs
- Dependency management and resolution (npm, pip, PlatformIO library registry)

---

## Project: DPA (Digital Playback Asset) Platform

**Role:** Full-Stack IoT Engineer — Firmware, Web Portal, Systems Integration

A physical hi-fi music player (credit-card form factor) with an encrypted content ecosystem, companion web portals for artists and fans, and mesh networking for synchronized playback.

### What I Built

**Firmware (ESP32-S3 C++)**
- Complete audio playback engine: SD card → FLAC decode → I2S → PCM5122 DAC (24-bit/96kHz)
- 29 LED strip patterns: solid, breathing, pulse, comet, rainbow, fire, sparkle, wave, meteor, theater chase, bounce, and 11 audio-reactive modes (VU classic, fill, peak hold, stereo split, bass, energy)
- REST API (15+ endpoints) over WiFi AP for real-time device control from browser
- Capsule ingest system: POST from portal → runtime store → SD persistence → survives reboot
- Artwork serving pipeline: `/api/art` endpoint streams images from SD with MIME detection and cache headers
- Dynamic WiFi SSID: `Artist-Album-DPA` assembled from metadata
- NVS persistence for LED themes, WiFi credentials, and device identity

**Creator Portal (Angular 21 + TypeScript)**
- Album management: metadata, track upload, cover art, per-track artwork
- Theme editor: DCNP perk notification colors with live device mockup LED preview
- Capsule builder: 6 event types (concert, video, merch, signing, remix, other) with type-specific forms, payload validation, device push, delivery status tracking, and device reconciliation
- Track list: drag-and-drop ordering, play count display from device analytics, artwork upload to device `/art/` folder
- Booklet editor, pricing calculator, fleet tracker, device management

**Fan Portal (Angular 21 + TypeScript)**
- Device registration via serial ID, NFC tap, or BLE scan
- LED strip tuning: idle/playback/charging modes, 29 patterns, brightness slider, VU gradient picker
- Real-time LED preview: debounced `/api/led/preview` calls to physical hardware
- Capsule inbox: browse and interact with artist-pushed perks
- Audio controls: volume, EQ presets, playback mode, Bluetooth A2DP pairing

**Hardware-Software Integration**
- Wired portal UI controls to firmware NVS keys 1:1 (brightness, gradient, pattern names match `led.h`)
- Designed flat JSON capsule protocol for reliable parsing on constrained device
- Built bidirectional theme sync: portal reads `/api/status`, device accepts `/api/theme` POST
- Implemented shared capsule ID system across portal localStorage and device SD storage
- Created artwork pipeline: portal upload → device sync server (port 81) → SD `/art/` → firmware API serve

---

## Technical Environment

| Category | Technologies |
|----------|-------------|
| Languages | TypeScript, C++ (Arduino/ESP-IDF), HTML5, CSS3 |
| Frameworks | Angular 21, Tailwind CSS 4, FastLED, ESPAsyncWebServer, AsyncTCP |
| Hardware | ESP32-S3 Zero, PCM5122 DAC, WS2812B LED strip, PN532 NFC, SD/SPI flash |
| Protocols | REST/HTTP, WiFi (AP+STA), Bluetooth LE, A2DP, ESP-NOW, NFC/NDEF, I2S, SPI |
| Tools | PlatformIO, Angular CLI, Git, GitHub, npm, Chrome DevTools, VS Code |
| Concepts | IoT, embedded systems, real-time audio, mesh networking, DRM (AES-256-GCM), signal-based reactivity, CORS, NVS |

---

## Relevant Industries

- Consumer Electronics & Smart Devices
- Music Technology & Audio Hardware
- IoT & Connected Device Platforms
- Digital Media & Content Protection
- Creative Tools & Artist Platforms
- Automotive & Industrial IoT (transferable embedded + dashboard patterns)

---

## Education & Certifications

*(Add your education, bootcamps, certifications, or relevant coursework here)*

---

## Contact

*(Add your email, LinkedIn, GitHub, portfolio URL here)*
