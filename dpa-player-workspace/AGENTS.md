# AGENTS.md — DPA Player

## Project overview

**DPA Player** — a portable hi-res music player (24/96 FLAC + WAV) with
reactive LED effects, cover-art upload, heart/favorite system, beat
detection, and a captive-portal upload flow.

This workspace is a **frozen snapshot** of the DPA Album codebase
(`cortknoxx-coder/dpa-aup@2aedf75`) stripped of Album-specific features
(artist TRACKS, capsules, DUID binding, creator endpoints, admin lock).

> **This is a standalone repo. Do NOT pull changes from, or push
> changes to, the DPA Album repo (`DPA-AUP`). They are forever
> separate — like iPod vs. iTunes.**

### Workspace layout

```
DPA-Player/
├── firmware/
│   └── dpa-player-esp32/      # Pure ESP-IDF 5.x firmware
│       ├── platformio.ini     # framework = espidf (NOT arduino)
│       ├── CMakeLists.txt
│       ├── sdkconfig.defaults
│       ├── partitions.csv
│       ├── main/              # Buildable ESP-IDF entry point
│       │   ├── CMakeLists.txt
│       │   └── main.c
│       └── arduino-src/       # Frozen Album reference — DO NOT BUILD
├── portal/                    # Angular 21 Player portal
│   ├── angular.json           # dev-server port 8090
│   ├── proxy.conf.json        # proxies to 192.168.5.1
│   └── src/
├── AGENTS.md
├── README.md
└── .gitignore
```

### Network isolation — always use these, never DPA Album defaults

| Setting            | DPA Album (do NOT use) | DPA Player (use these) |
| ------------------ | ---------------------- | ---------------------- |
| AP IP              | `192.168.4.1`          | `192.168.5.1`          |
| SSID prefix        | `DPA-XXXX`             | `DPA-Player-XXXX`      |
| Angular dev port   | `3000`                 | `8090`                 |
| API proxy prefix   | `/dpa-api`             | `/player-api`          |
| Upload proxy       | `/dpa-upload`          | `/player-upload`       |
| mDNS / hostname    | `dpa-device.local`     | `dpa-player.local`     |

### Firmware stack — pure ESP-IDF, no Arduino

| Subsystem        | Library                                  |
| ---------------- | ---------------------------------------- |
| WiFi / AP        | `esp_wifi` + `esp_netif` + `esp_event`   |
| HTTP server      | `esp_http_server` (no ESPAsyncWebServer) |
| Captive DNS      | Custom ~80-line UDP DNS handler          |
| SD card          | `esp_vfs_fat_sdspi_mount` + POSIX I/O    |
| I2S audio        | `driver/i2s_std.h`                       |
| FLAC decode      | `dr_flac.h` (single-header, public domain) |
| LEDs             | `led_strip` component (RMT peripheral)   |
| NVS / prefs      | `nvs_flash` (no Arduino Preferences)     |
| Logging          | `esp_log` (no Serial.print)              |
| Strings          | plain `char*` + `snprintf` (no `String`) |

**Do NOT re-introduce Arduino.h, WiFi.h, SD.h, FastLED.h,
ESPAsyncWebServer.h, DNSServer.h, Preferences.h, or `String` class.**
These only live in `arduino-src/` as read-only reference.

### Dev commands

#### Portal

| Action           | Command                                 |
| ---------------- | --------------------------------------- |
| Install deps     | `cd portal && npm install --legacy-peer-deps` |
| Dev server       | `cd portal && npm run dev` (port 8090)  |
| Production build | `cd portal && npm run build`            |

#### Firmware

| Action  | Command                                                         |
| ------- | --------------------------------------------------------------- |
| Build   | `cd firmware/dpa-player-esp32 && pio run`                       |
| Upload  | `cd firmware/dpa-player-esp32 && pio run --target upload`       |
| Monitor | `cd firmware/dpa-player-esp32 && pio device monitor -b 115200`  |
| Clean   | `cd firmware/dpa-player-esp32 && pio run --target clean`        |

### Phases

| Phase | Scope                                                          | Status |
| ----- | -------------------------------------------------------------- | ------ |
| 0     | Clone & scaffold pure ESP-IDF project                          | DONE   |
| 1     | WiFi AP + captive DNS (192.168.5.1, SSID `DPA-Player-XXXX`)    | TODO   |
| 2     | SD mount + multi-folder library scanner + .dpa wrap/unwrap     | TODO   |
| 3     | HTTP API + upload server + Angular portal baseline             | TODO   |
| 4     | FLAC + WAV playback via dr_flac + i2s_std + 10-band EQ         | TODO   |
| 5     | LED strip (RMT) + audio-reactive + cover-art extraction        | TODO   |
| 6     | Hearts / favorites, shuffle, ReplayGain, sleep timer           | TODO   |
| 7     | Polish: OTA, crossfade, metadata UI                            | TODO   |

### Snapshot origin

```
upstream:   cortknoxx-coder/dpa-aup
commit:     2aedf75c8800e170f9b47dbc4d7ec155acfaff33
date:       2026-04-11
strategy:   single snapshot commit — no preserved history
```
