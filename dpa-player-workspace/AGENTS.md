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
| 1     | WiFi AP + captive DNS (192.168.5.1, SSID `DPA-Player-XXXX`)    | DONE   |
| 2a    | SD card mount (esp_vfs_fat_sdspi) with graceful failure        | DONE   |
| 2b    | DPA1 container parser + library scanner                        | DONE   |
| 3     | HTTP API — `/api/status` `/api/library` `/api/player/*`        | DONE   |
| 4a    | Transport state machine (play/pause/seek/vol/shuffle/repeat)   | DONE   |
| 4b    | Real audio — dr_flac + i2s_std decoder pipeline                | TODO   |
| 5a    | LED mode/color/brightness state tracker                        | DONE   |
| 5b    | Real LED — led_strip component (RMT backend)                   | TODO   |
| 6     | Hearts / favorites, ReplayGain, sleep timer                    | TODO   |
| 7     | Polish: OTA, crossfade, metadata UI                            | TODO   |

### Simulation mode

While developing before the DAC / LED strip / SD adapter are wired
up, the firmware runs with **`DPA_PLAYER_SIM_MODE = 1`** (default in
`main/config.h`). Every hardware-dependent subsystem has a SIM path:

| Module   | `DPA_PLAYER_SIM_*` flag   | SIM behavior                                     |
| -------- | ------------------------- | ------------------------------------------------ |
| sd_card  | `DPA_PLAYER_SIM_SD`       | Fake 30 GB SDHC "SIM-SDHC", no SPI bus touched   |
| library  | (follows SD)              | Seeded canned catalog of 8 tracks                |
| audio    | `DPA_PLAYER_SIM_AUDIO`    | Transport + 250 ms tick task, no I2S             |
| led      | `DPA_PLAYER_SIM_LED`      | RGB state + log lines, no RMT traffic            |

To flip the whole firmware to real-hardware mode once everything is
soldered, edit `main/config.h` and set `DPA_PLAYER_SIM_MODE 0` (or
flip individual subsystems). Each submodule re-enters its real code
path without any other source file changing.

The `sim:true` flag is also reflected in `GET /api/status` so the
Angular portal can badge "SIM" until real hardware takes over.

### Snapshot origin

```
upstream:   cortknoxx-coder/dpa-aup
commit:     2aedf75c8800e170f9b47dbc4d7ec155acfaff33
date:       2026-04-11
strategy:   single snapshot commit — no preserved history
```
