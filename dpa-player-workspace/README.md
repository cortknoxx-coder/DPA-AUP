# DPA Player

Portable hi-res (24/96) music player with reactive LED effects,
cover-art upload, hearts, beat detection, and a captive-portal upload
flow. Ships as a sub-product of the DPA platform by The DPAC.

> **About this location:** DPA Player is developed here as a subtree
> of the DPA-AUP repo because the cloud-sandbox commit-signing server
> is hard-scoped to that repo. DPA Player files are fully isolated
> (no shared imports, no touched DPA Album files, no shared runtime
> network — different AP IP, different SSID, different ports). When
> ready, this subtree graduates to its own GitHub repo
> (`cortknoxx-coder/DPA-Player`) via
> `git subtree split --prefix=dpa-player-workspace`.

| | |
|-|-|
| **Hardware** | Waveshare ESP32-S3 Zero + PCM5122 DAC + microSD + WS2812B LED + headphone jack |
| **Codecs** | WAV (up to 32/96) + FLAC (up to 24/96) |
| **Firmware** | Pure ESP-IDF 5.x (no Arduino framework) |
| **Portal** | Angular 21 standalone components |
| **AP IP** | `192.168.5.1` |
| **SSID** | `DPA-Player-XXXX` (last 4 of MAC) |

## What's in the box (this repo)

```
firmware/dpa-player-esp32/   ESP-IDF firmware project
portal/                      Angular 21 Player portal
AGENTS.md                    Dev instructions (READ FIRST)
```

## Quickstart

### Portal (dev server)

```bash
cd portal
npm install --legacy-peer-deps
npm run dev          # opens http://localhost:8090
```

### Firmware (PlatformIO)

```bash
cd firmware/dpa-player-esp32
pio run                          # build
pio run --target upload          # flash via USB-C
pio device monitor -b 115200     # logs
```

## Differences vs DPA Album

| Feature                         | Album | Player |
| ------------------------------- | :---: | :----: |
| Hardcoded artist TRACKS[]       |  Yes  |  No    |
| Capsules (concert/video/merch)  |  Yes  |  No    |
| DUID content binding            |  Yes  |  No    |
| User-upload WAV/FLAC library    |  No   |  Yes   |
| Multi-folder library scanner    |  No   |  Yes   |
| FLAC decoder                    |  No   |  Yes   |
| 10-band EQ + presets            | Partial | Yes  |
| Shuffle + ReplayGain            |  No   |  Yes   |
| LED reactive effects            |  Yes  |  Yes   |
| Cover-art upload                |  Yes  |  Yes   |
| Hearts / favorites              |  Yes  |  Yes   |
| Captive-portal upload           |  Yes  |  Yes   |

## License

See LICENSE.
