# Arduino reference source — DO NOT BUILD

This directory contains a **frozen snapshot** of the DPA Album firmware
at commit `DPA-AUP@2aedf75c8800e170f9b47dbc4d7ec155acfaff33`.

It is **reference material only**. The DPA Player firmware builds from
`main/main.c` using the pure ESP-IDF toolchain. These Arduino-framework
files live here so each subsystem can be ported cleanly, file by file,
as the project moves through its phases:

| Phase | Source here                 | Port target                      |
| ----- | --------------------------- | -------------------------------- |
| 1     | `dpa_wifi.h`                | `main/wifi.c` (esp_wifi native)  |
| 2     | `sd_card.h`                 | `main/sd.c` (esp_vfs_fat_sdspi)  |
| 3     | `api.h`, `captive.h`        | `main/http.c` (esp_http_server)  |
| 4     | `audio.h`                   | `main/audio.c` (i2s_std + dr_flac) |
| 5     | `led.h`, `audio_reactive.h` | `main/led.c` (led_strip RMT)     |
| 6     | `intelligence.h`, `.ino`    | `main/library.c` + `main/app.c`  |

### Key rules

1. Code here **does not compile** in the Player build — it still uses
   `WiFi.h`, `FastLED.h`, `ESPAsyncWebServer.h`, etc. which are NOT in
   the Player's `idf_component_register` REQUIRES list.
2. Code here **must not be modified** during porting. Treat it as a
   read-only oracle. If behaviour needs to change, change `main/`, not
   `arduino-src/`.
3. Once a phase's port is verified working, the corresponding files
   here can be deleted (one commit per phase, after the port is
   signed off).
4. **Do not edit any file in DPA-AUP.** This workspace is a standalone
   snapshot; upstream changes are *not* pulled in.

### Origin

```
upstream repo:   cortknoxx-coder/dpa-aup
upstream commit: 2aedf75c8800e170f9b47dbc4d7ec155acfaff33
snapshot date:   2026-04-11
```
