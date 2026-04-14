# DPA System Architecture

**DPA** (Digital Playback Asset) — brought to you by **The DPAC** (Digital Playback Asset Consortium)

**Firmware:** v2.4.1+ (Phase-4) | **Platform:** Waveshare ESP32-S3 Zero + Angular 21 Creator/Fan Portal

> **Hardware note:** Any mention of ESP32-WROVER-32 / WROOM-32 below is legacy from earlier prototyping. The current MCU is the **Waveshare ESP32-S3 Zero** (8MB flash, no PSRAM, USB-C CDC). API endpoints, protocols, and portal architecture are unchanged — only the pin mapping and flash layout differ. See [`HARDWARE-WIRING.md`](HARDWARE-WIRING.md) for the authoritative pinout.

---

## System Overview

DPA (Digital Playback Asset) is a physical music player brought to you by **The DPAC** (Digital Playback Asset Consortium). Each device holds one album in hi-fi FLAC 24/96 with music videos, downloadable capsule perks, and a mesh network for synchronized playback across devices.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FAN'S PHONE / BROWSER                        │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                   ANGULAR 21 PORTAL                           │  │
│  │                                                               │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │  │
│  │  │ Fan Home │  │  Audio   │  │ Capsules │  │   Settings  │  │  │
│  │  │ (Albums) │  │ Settings │  │  (Perks) │  │  (LED/Auth) │  │  │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬──────┘  │  │
│  │       │              │              │               │         │  │
│  │  ┌────┴──────────────┴──────────────┴───────────────┴──────┐  │  │
│  │  │            DeviceConnectionService                      │  │  │
│  │  │         (BLE / WiFi / NFC orchestrator)                 │  │  │
│  │  └────────────┬──────────────┬──────────────┬──────────────┘  │  │
│  │               │              │              │                 │  │
│  │  ┌────────────┴┐  ┌─────────┴──┐  ┌───────┴────────┐       │  │
│  │  │ BLE Service │  │WiFi Service│  │  NFC Service   │       │  │
│  │  │ Web BT API  │  │ HTTP fetch │  │  Web NFC API   │       │  │
│  │  └─────────────┘  └────────────┘  └────────────────┘       │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                    │              │              │
                    │ BLE GATT     │ HTTP REST    │ NDEF
                    │              │              │
┌───────────────────┴──────────────┴──────────────┴───────────────────┐
│                       ESP32 DPA DEVICE                              │
│                                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │   BLE    │  │  WiFi AP │  │  PN532   │  │  A2DP    │           │
│  │  GATT    │  │  + REST  │  │   NFC    │  │  Source  │           │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│       │              │              │              │                │
│  ┌────┴──────────────┴──────────────┴──────────────┴────────────┐  │
│  │                    COMMAND DISPATCHER                         │  │
│  └──┬──────────┬──────────┬──────────┬──────────┬───────────────┘  │
│     │          │          │          │          │                   │
│  ┌──┴───┐  ┌──┴───┐  ┌──┴───┐  ┌──┴───┐  ┌──┴──────┐            │
│  │Player│  │ LED  │  │ NVS  │  │ESP-NOW│  │  XTSD   │            │
│  │Engine│  │ RGB  │  │Config│  │ Mesh  │  │ Storage │            │
│  └──────┘  └──────┘  └──────┘  └───┬───┘  └─────────┘            │
│                                     │                              │
│                              ┌──────┴──────┐                       │
│                              │ Other DPA   │                       │
│                              │  Devices    │                       │
│                              └─────────────┘                       │
└────────────────────────────────────────────────────────────────────┘
```

---

## Connection Methods

### NFC Tap (Instant Discovery)

| Aspect | Detail |
|--------|--------|
| Hardware | PN532 via I2C (GPIO 21/22) |
| Tag Format | NDEF URL: `https://dpa.audio/d/{DUID}` |
| Portal API | Web NFC API (`NDEFReader.scan()`) |
| Flow | Phone tap -> read DUID -> portal auto-connects BLE |
| Browser Support | Android Chrome only |

### BLE (Persistent Control)

| Aspect | Detail |
|--------|--------|
| Service D1A0 | Info: DUID (D1A1), Status JSON (D1A2), FW Version (D1A3) |
| Service D1D0 | Control: Command byte write (D1D1) |
| Portal API | Web Bluetooth API |
| Flow | Scan for service 0x D1A0 -> connect -> subscribe to D1A2 notify |
| Browser Support | Chrome, Edge, Opera (desktop + Android) |

### WiFi AP (Data Transfer)

| Aspect | Detail |
|--------|--------|
| SSID | Device DUID (e.g., `DPA-AB12`) |
| Password | `dpa12345` |
| IP | `192.168.4.1` |
| Flow | Join device WiFi -> portal probes `/api/status` -> HTTP mode |
| Use Case | File uploads, theme push, capsule delivery |

### A2DP Source (Wireless Audio)

| Aspect | Detail |
|--------|--------|
| Role | ESP32 acts as A2DP **Source** (sends audio) |
| Target | Bluetooth speakers, headphones |
| Codec | SBC (standard Bluetooth audio) |
| Control | Scan, connect, disconnect via BLE commands or WiFi API |

---

## Firmware REST API

Port 80 (async ESPAsyncWebServer) serves the dashboard + all API endpoints. Port 81 (sync WebServer) handles large file uploads reliably.

All endpoints at `http://192.168.4.1` when WiFi AP is active.

### Status & Discovery

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/status` | — | Full device state JSON (player, storage, WiFi, battery, LEDs, favorites, capsules, analytics, runtime) |
| GET | `/api/admin/unlock?key=<DUID>` | — | Unlock admin mode |
| GET | `/api/admin/lock` | — | Lock admin mode |

### Playback Control

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/cmd?op=XX` | — | Command opcode (0x01=play/pause, 0x02=pause, 0x03=next, 0x04=prev, 0x60=vol+, 0x61=vol-) |
| GET | `/api/track?i=N` | — | Play track by index |
| GET | `/api/audio/play?file=/path` | — | Play file by path |
| GET | `/api/audio/stop` | — | Stop playback |
| GET | `/api/audio/seek?ms=N` | — | Seek to milliseconds |
| GET | `/api/audio/test` | — | Play test tone |
| GET | `/api/audio/tracks` | — | List all playable tracks (.dpa primary, .wav fallback) |

### Audio Settings

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/volume?level=0-100` | — | Set volume (persisted to NVS) |
| GET | `/api/eq?preset=X` | — | Set EQ preset (flat, bass_boost, vocal, warm, bright, loudness, r_and_b, electronic, late_night) |
| GET | `/api/eq/custom?bass=X&mid=X&treble=X` | — | Custom 3-band EQ |
| GET | `/api/mode?mode=X` | — | Set playback mode (normal, repeat_one) |

### Audio Features & Analytics

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/audio/features` | — | Real-time audio features (peakL, peakR, rms, envelope, bassEnergy, beat) |
| GET | `/api/analytics` | — | Per-track play/skip counts and ratings |

### Favorites

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/favorites/set?file=X&state=true\|false` | — | Idempotent favorite set |
| GET | `/api/favorites/toggle?file=X` | — | Toggle favorite (legacy) |
| GET | `/api/favorites` | — | List all favorites |

### Content Metadata

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/booklet` | — | Album liner notes from /data/booklet.json |
| GET | `/api/album/meta` | — | Album metadata from /data/album_meta.json |
| GET | `/api/art?path=/art/cover.jpg` | — | Serves artwork (jpg/png/webp) |
| GET | `/api/capsules` | — | All runtime capsules (real pushed only) |

### Storage & Files

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/storage` | — | SD card stats (totalMB, usedMB, freeMB, trackCount, capsuleCount) |
| GET | `/api/sd/files?dir=/` | ADMIN | List files in directory |
| POST | `/api/sd/upload?path=/tracks/X` | ADMIN | Multipart upload (8KB buffered, .part temp files) |
| POST | `/api/sd/upload-raw?path=/X` | ADMIN | Streaming chunked upload |
| DELETE | `/api/sd/delete?path=/X` | ADMIN | Delete file from SD |

### Content Push (Creator)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/theme` | — | Full LED theme JSON (colors, patterns, brightness, gradEnd, DCNP colors, artist/album meta) |
| POST | `/api/capsule` | — | Ingest/upsert capsule (id, type, title, desc, date, delivered, price, ctaLabel, ctaUrl) |

### LED

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/led/preview?mode=M&color=C&pattern=P&brightness=N&gradEnd=C` | — | Preview + save LED config (supports genre hue ranges) |

### WiFi Management

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/wifi/status` | — | AP + STA connection status |
| GET | `/api/wifi/scan` | ADMIN | Scan available networks |
| GET | `/api/wifi/connect?ssid=X&pass=Y` | ADMIN | Connect to STA network |
| GET | `/api/wifi/disconnect` | ADMIN | Disconnect STA + clear NVS |

### Sync Upload Server (Port 81)

Separate synchronous WebServer for reliable large file uploads. Avoids contention with async port 80.

**Upload State Machine:** `idle` -> `preparing` -> `receiving` -> `verifying` -> `finalizing` -> `complete` | `error`

Portal monitors via `runtime.uploadState` in `/api/status`.

### Mesh (ESP-NOW, currently disabled)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/mesh` | — | ESP-NOW peer info (DUID, MAC, age) |

---

## BLE GATT Profile

### Service: Device Info (UUID: 0000D1A0-...)

| Characteristic | UUID | Properties | Format | Description |
|---------------|------|------------|--------|-------------|
| Device ID | D1A1 | Read | UTF-8 string | DUID (e.g., "DPA-AB12") |
| Status | D1A2 | Read, Notify | UTF-8 JSON | Full device status (same as /api/status) |
| FW Version | D1A3 | Read | UTF-8 string | "1.0.0" |

### Service: Control (UUID: 0000D1D0-...)

| Characteristic | UUID | Properties | Format | Description |
|---------------|------|------------|--------|-------------|
| Command | D1D1 | Write | 1 byte uint8 | Command code (see table below) |

### Command Codes

| Command | Hex | Dec | Description |
|---------|-----|-----|-------------|
| Play | 0x01 | 1 | Start playback |
| Pause | 0x02 | 2 | Pause playback |
| Next Track | 0x03 | 3 | Skip to next track |
| Previous Track | 0x04 | 4 | Go to previous track |
| Get Status | 0x10 | 16 | Trigger BLE status notification |
| BT Pairing | 0x20 | 32 | Clear bonds, restart advertising |
| Start Portal | 0x30 | 48 | Enable WiFi AP + web server |
| Stop Portal | 0x31 | 49 | Disable WiFi AP |
| ESP-NOW Sync | 0x40 | 64 | Broadcast sync to mesh peers |
| ESP-NOW Discover | 0x41 | 65 | Broadcast mesh discovery |
| A2DP Scan | 0x50 | 80 | Start BT Classic device scan |
| A2DP Connect | 0x51 | 81 | Connect to last scanned device |
| A2DP Disconnect | 0x52 | 82 | Disconnect A2DP sink |
| Volume Up | 0x60 | 96 | Increase volume by 5% |
| Volume Down | 0x61 | 97 | Decrease volume by 5% |
| Cycle Mode | 0x62 | 98 | Cycle playback mode |
| Cycle EQ | 0x63 | 99 | Cycle EQ preset |

---

## .dpa Encrypted Container Format

All content files (FLAC audio, videos, capsules) are encrypted into `.dpa` containers that can only be decrypted by the target device.

### File Structure

```
Offset  Size    Field               Description
──────  ──────  ──────────────────  ────────────────────────────────
0x00    4       Magic               "DPA\x01" (0x44 0x50 0x41 0x01)
0x04    1       Version             0x01
0x05    1       Flags               bit0=FLAC, bit1=Video, bit2=Capsule
0x06    32      DUID Hash           SHA-256(DUID + "DPA-MASTER-2026")
0x26    12      IV / Nonce          Random 12-byte nonce
0x32    N       Encrypted Payload   AES-256-GCM ciphertext + 16-byte tag
```

**Total header size:** 50 bytes

### Encryption Flow

```
                   Portal (Browser)                    Device (ESP32)
                   ─────────────────                   ──────────────
1. Creator uploads  ┌──────────────┐
   raw FLAC file    │  Raw Audio   │
                    └──────┬───────┘
                           │
2. Derive key       SHA-256(DUID + "DPA-MASTER-2026")
                           │
                    ┌──────┴───────┐
3. Encrypt          │ AES-256-GCM │
   (WebCrypto)      │ + random IV │
                    └──────┬───────┘
                           │
4. Build .dpa       ┌──────┴───────┐
   container        │  .dpa File   │
                    └──────┬───────┘
                           │
5. Transfer         ───── POST /api/upload ─────►  ┌──────────────┐
   via WiFi                                        │  XTSD Flash  │
                                                   │  /tracks/    │
                                                   └──────┬───────┘
                                                          │
6. Playback                                        ┌──────┴───────┐
   on device                                       │  Verify DUID │
                                                   │  Hash Match  │
                                                   └──────┬───────┘
                                                          │
                                                   ┌──────┴───────┐
                                                   │  AES-256-GCM │
                                                   │  Decrypt     │
                                                   │  (mbedtls)   │
                                                   └──────┬───────┘
                                                          │
                                                   ┌──────┴───────┐
                                                   │  FLAC Decode │
                                                   │  (dr_flac)   │
                                                   └──────┬───────┘
                                                          │
                                                   ┌──────┴───────┐
                                                   │  I2S Output  │
                                                   │  PCM5122 DAC │
                                                   └──────────────┘
```

### Key Derivation

Both the portal (browser WebCrypto) and firmware (mbedtls) derive the same key:

```
key_material = UTF8_ENCODE(DUID + "DPA-MASTER-2026")
key          = SHA-256(key_material)              // 32 bytes = AES-256
```

### DUID Hash Verification

Before decryption, the device checks that the file was encrypted for this device:

```
stored_hash   = bytes[6..38] from .dpa header
expected_hash = SHA-256(own_DUID + "DPA-MASTER-2026")

if stored_hash != expected_hash:
    reject with DPA_WRONG_DEVICE
```

---

## ESP-NOW Mesh Protocol

DPA devices form an ad-hoc mesh network for synchronized playback and capsule notification relay.

### Message Types

| Type | Code | Struct | Size | Purpose |
|------|------|--------|------|---------|
| Discovery | 0x01 | ENDiscovery | 28 bytes | Announce presence |
| Discovery ACK | 0x02 | ENDiscovery | 28 bytes | Respond to discovery |
| Command | 0x03 | ENCommand | 30 bytes | Remote playback control |
| Status | 0x04 | ENStatus | 22 bytes | Periodic state broadcast |
| Sync | 0x05 | ENSync | 25 bytes | Synchronized playback start |
| Capsule | 0x06 | ENCapsule | 46 bytes | Capsule notification relay |

### Packet Header (all messages)

```
Offset  Size  Field        Description
0       1     msgType      Message type code
1       1     seqNum       Sequence number (0-255, wrapping)
2       12    senderDuid   Sender device DUID string
14      2     payloadLen   Payload size after header
```

### Mesh Behavior

- Discovery broadcasts every 5 seconds
- Peers timeout after 15 seconds of inactivity
- Maximum 6 simultaneous peers
- Channel 6 (matches WiFi AP channel)
- No encryption (local proximity mesh)
- Capsule notifications relay through mesh so all nearby devices flash

---

## Status JSON Schema

Returned by `GET /api/status` and BLE characteristic D1A2:

```json
{
  "name": "dpa-device",
  "ver": "2.4.1",
  "duid": "DPA-AB12",
  "ble": true,
  "wifi": true,
  "ip": "192.168.4.1",
  "uptime_s": 3600,
  "adminMode": false,

  "audio": {
    "volume": 75,
    "eq": "flat",
    "mode": "normal",
    "a2dp": "disconnected",
    "a2dpDevice": ""
  },

  "battery": {
    "percent": 85,
    "voltage": 3.95,
    "charging": false
  },

  "storage": {
    "totalMB": 1800,
    "usedMB": 200,
    "freeMB": 1600,
    "trackCount": 12,
    "capsuleCount": 3
  },

  "player": {
    "trackIndex": 0,
    "trackId": "s1",
    "playing": true,
    "posMs": 45000
  },

  "led": {
    "brightness": 80,
    "idleColor": "#00ff88",
    "idlePat": "rainbow",
    "playColor": "#00aaff",
    "playPat": "vu_classic",
    "gradEnd": "#ff6600"
  },

  "favorites": ["/tracks/song1.dpa"],
  "capsules": [],

  "counts": {
    "play": 15,
    "pause": 8,
    "next": 12,
    "prev": 3
  },

  "runtime": {
    "bootState": "ready",
    "sdState": "mounted",
    "uploadState": "idle",
    "degradedReason": "",
    "httpReady": true,
    "httpMode": "ap",
    "audioVerified": true,
    "wifiMaintenance": false,
    "lastUploadPath": "",
    "lastUploadBytes": 0
  },

  "coverBytes": 45231,
  "artistName": "808 Dreams",
  "albumTitle": "Midnight Horizons"
}
```

### Runtime Status Fields (new in v2.4.1)

| Field | Values | Purpose |
|-------|--------|---------|
| `runtime.bootState` | `booting`, `ready`, `degraded` | Device boot lifecycle phase |
| `runtime.sdState` | `mounted`, `unmounted`, `error` | SD card health |
| `runtime.uploadState` | `idle`, `preparing`, `receiving`, `verifying`, `finalizing`, `complete`, `error` | Upload state machine — portal monitors this for progress |
| `runtime.degradedReason` | `""`, `sd_fail`, `audio_fail` | Why device entered degraded mode |
| `runtime.httpReady` | bool | Web server fully initialized |
| `runtime.httpMode` | `ap`, `sta`, `ap+sta` | Current WiFi operating mode |
| `runtime.audioVerified` | bool | I2S + DAC init confirmed |
| `runtime.wifiMaintenance` | bool | WiFi sleep disabled for upload reliability |
| `runtime.lastUploadPath` | string | Path of last successful upload |
| `runtime.lastUploadBytes` | number | Size of last successful upload |
| `coverBytes` | number | Size of cover art file on SD (0 if none) |
| `artistName` | string | Artist name from theme push |
| `albumTitle` | string | Album title from theme push |

---

## LED Notification System

### Capsule Perk Types

Each perk type has a configurable color (set in theme editor) and a fixed animation pattern:

| Perk Type | Default Color | Animation | Duration |
|-----------|--------------|-----------|----------|
| Concert | #ff4bcb (Magenta) | Rapid pulse 3x, then breathing | ~33s |
| Video | #00f1df (Cyan) | Slow fade in/out, repeat 2x | ~14s |
| Merch | #ffcc33 (Gold) | 3 quick flashes, solid glow | ~11s |
| Remix | #ff4500 (Hot Orange) | Rhythmic pulse at 120 BPM | 15s |
| Signing | #7d29ff (Purple) | Slow breathing (inhale/exhale) | 30s |
| Other | #ffffff (White) | 2 gentle flashes | ~1.2s |

### LED State Modes

| Mode | Color Source | Animation | When |
|------|-------------|-----------|------|
| Idle | Theme idle color | Breathing | Device on, not playing |
| Playback | Theme playback color | Pulse | Currently playing audio |
| Charging | Theme charging color | Slow breathing | Battery charging |
| Notification | DCNP perk color | Per-type pattern | Capsule received |

### Theme NVS Storage

LED theme settings persist across reboots:

| NVS Key | Type | Default | Description |
|---------|------|---------|-------------|
| `led_idle` | String | `#00ff88` | Idle state LED color |
| `led_play` | String | `#00aaff` | Playback state LED color |
| `led_charge` | String | `#ffaa00` | Charging state LED color |
| `led_idle_pat` | String | `breathing` | Idle animation pattern |
| `dcnp_concert` | String | `#ff4bcb` | Concert notification color |
| `dcnp_video` | String | `#00f1df` | Video notification color |
| `dcnp_merch` | String | `#ffcc33` | Merch notification color |
| `dcnp_remix` | String | `#ff4500` | Remix notification color |
| `dcnp_signing` | String | `#7d29ff` | Signing notification color |
| `dcnp_other` | String | `#ffffff` | Other notification color |

---

## Portal Architecture

### Angular 21 Application

| Technology | Version | Purpose |
|-----------|---------|---------|
| Angular | 21 | Application framework |
| Vite | 6.x | Build tool |
| Tailwind CSS | 4.x | Utility-first styling |
| TypeScript | 5.9 | Type safety |

### Key Services

| Service | File | Responsibility |
|---------|------|---------------|
| DeviceConnectionService | `device-connection.service.ts` | Transport orchestrator (WiFi/BLE/NFC/USB Bridge), auto-detect, polling, sync |
| DeviceBleService | `device-ble.service.ts` | Web Bluetooth GATT operations |
| DeviceWifiService | `device-wifi.service.ts` | HTTP client for device REST API, upload/delete/reorder, analytics, cloud analytics relay |
| CryptoService | `crypto.service.ts` | .dpa encryption/decryption (WebCrypto) |
| PlayerService | `player.service.ts` | Playback with device command routing |
| DataService | `data.service.ts` | Album/track data, mock data detection, device sync, capsule feeds |
| FleetService | `fleet.service.ts` | Live cloud fleet analytics (KPIs, devices, top tracks, activity feed) |
| ReleaseBuildService | `release-build.service.ts` | Album compile, metadata save, firmware push pipeline |
| CartService | `cart.service.ts` | Shopping cart for capsule marketplace |
| InternalOperatorAuthService | `internal-operator-auth.service.ts` | Operator session management for cloud admin routes |

### Key Utilities & Guards

| File | Purpose |
|------|---------|
| `device-content.utils.ts` | Normalizers: `normalizeDeviceCapsuleRecord()`, `normalizeDeviceBookletPayload()`, `normalizeDeviceAlbumMetaPayload()`, `mergeCapsuleFeeds()` |
| `default-cover.ts` | Default cover art SVG generation |
| `portal-access.guard.ts` | Route guard for fan portal access |

### Key Signals (DeviceConnectionService)

| Signal | Type | Purpose |
|--------|------|---------|
| `connectionStatus` | `ConnectionStatus` | Current transport state (disconnected/connecting/connected/error) |
| `connectionBusy` | `ConnectionAction \| null` | UI loading indicator for active connection attempt |
| `deviceInfo` | `DeviceInfo \| null` | Device identity (DUID, firmware version) |
| `deviceLibrary` | `DeviceTrack[]` | Track list synced from device |
| `deviceCapsules` | `DeviceCapsuleRecord[]` | Capsules synced from device |
| `deviceRuntime` | computed `DeviceRuntimeStatus \| null` | Boot/upload/SD state from status polling |
| `deviceRuntimeMessage` | computed `string` | Human-readable runtime status summary |
| `deviceReadyForWrites` | computed `boolean` | True when device is idle and not uploading |
| `connectionTransportLabel` | computed `string` | "WiFi", "USB", "BLE", etc. |
| `connectionSummary` | computed `string` | "Connected via WiFi to DPA-AB12" |

### Key Types (types.ts)

| Type | Purpose |
|------|---------|
| `FanCapsule` | DcnpEvent extended with albumTitle, artistName, source ('portal'\|'device'\|'merged') |
| `DeviceCapsuleRecord` | Flat capsule record from device (id, type, title, desc, date, delivered, price, cta) |
| `DeviceBookletPayload` | Booklet data: description, lyrics, booklet (credits, gallery, videos) |
| `DeviceAlbumMetaPayload` | Album metadata: genre, recordLabel, copyright, releaseDate, upcCode, parentalAdvisory |
| `DeviceRuntimeStatus` | Runtime observability: bootState, sdState, uploadState, degradedReason, etc. |
| `FirmwareStatus` | Full /api/status response shape including runtime fields |

### Route Structure

```
/login                          Login screen
/artist/                        Creator portal
  /dashboard                    Album dashboard
  /albums/new                   Create new album
  /albums/:id/                  Album editor
    /overview                   Album overview
    /metadata                   Metadata editor
    /tracks                     Track list + upload
    /booklet                    Digital booklet
    /theme                      LED theme editor
    /perks                      Capsule perks console
    /pricing                    Pricing configuration
    /devices                    Device management
  /account                      Account settings
  /fleet                        Fleet tracker (mesh map)
/fan/                           Fan portal
  /auth                         Fan authentication
  /app/                         Fan app (layout + player)
    /home                       Album catalog
    /album/:id                  Album detail + player
    /capsules                   Capsule inbox
    /marketplace                Capsule marketplace
    /devices                    Device registration
    /checkout                   Cart checkout
    /audio                      Audio settings (volume/EQ/A2DP)
    /settings                   Profile + LED theme
```

---

## NVS (Non-Volatile Storage) Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `duid` | String | Auto-generated | Device unique ID (DPA-XXXX) |
| `volume` | UChar | 75 | Audio volume (0-100) |
| `eq` | UChar | 0 | EQ preset index |
| `mode` | UChar | 0 | Playback mode index |
| `led_idle` | String | #00ff88 | Idle LED color |
| `led_play` | String | #00aaff | Playback LED color |
| `led_charge` | String | #ffaa00 | Charging LED color |
| `led_idle_pat` | String | breathing | Idle animation |
| `dcnp_*` | String | Per-type | 6 notification colors |
| `theme` | String | {} | Full theme JSON blob |
| `manifest` | String | {} | Album manifest JSON |

---

## Build & Compile Flags

### Firmware Feature Matrix

| Flag | Controls | Dependencies |
|------|----------|-------------|
| `HAS_DAC` | PCM5122 + I2S + XTSD flash + FLAC decode | dr_flac.h, mbedtls |
| `HAS_NFC` | PN532 NFC tag emulation | Adafruit_PN532 library |
| `HAS_A2DP` | Bluetooth A2DP Source (auto-detected) | Arduino BT config = "BT + BLE" |

### Build Combinations

| Configuration | Use Case | Flash Size |
|--------------|----------|------------|
| No flags | Simulation / development | ~1.2 MB |
| HAS_DAC | Real audio without NFC | ~1.5 MB |
| HAS_DAC + HAS_NFC | Full hardware build | ~1.6 MB |
| HAS_DAC + HAS_NFC + HAS_A2DP | Complete with wireless audio | ~1.8 MB |

### Portal Build

```bash
npm install --legacy-peer-deps   # Install dependencies
npm run dev                       # Development server (localhost:3000)
npm run build                     # Production build (output: dist/)
```

No API keys required for local development. Cloud features require Vercel environment variables.

---

## Vercel Cloud Backend

The portal is deployed to Vercel with a full cloud backend for persistent state, analytics, and fleet management.

### Cloud Services

| Service | Provider | Purpose |
|---------|----------|---------|
| Database | Neon Postgres (serverless) | Device registry, analytics events, operator sessions, firmware versions |
| Cache/Presence | Upstash Redis | Real-time device presence tracking, session cache, rate limiting |
| Object Storage | Vercel Blob | Firmware binary storage, artwork assets |
| Feature Flags | Vercel Edge Config | Maintenance mode, firmware pointers, portal announcements |
| Scheduled Jobs | Vercel Cron | Fleet health checks (5 min), analytics rollup (daily) |
| Request Processing | Vercel Edge Middleware | Admin auth gate, maintenance mode, geo headers |

### Cloud API Routes (`/internal-api/...`)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/health` | — | Service health (Postgres, Redis, Blob, Edge Config status) |
| POST | `/operator/login` | — | Operator session creation (returns session cookie) |
| POST | `/device/check-in` | Device/Operator | Device heartbeat with status + analytics snapshot |
| POST | `/analytics/events` | — | Batch analytics event ingestion (play, skip, heart, listen_ms) |
| GET | `/analytics/device/:duid` | Operator | Per-device analytics detail |
| GET | `/fleet/status` | Operator | All registered devices with reachability state |
| GET | `/fleet/analytics` | Operator | Fleet-wide KPIs, top tracks, recent activity feed |
| GET | `/firmware/latest` | — | Latest stable firmware (checks Edge Config pointer first) |

### Cron Jobs

| Schedule | Route | Purpose |
|----------|-------|---------|
| Every 5 minutes | `/api/cron/fleet-health` | Mark stale/offline devices, expire operator sessions |
| Daily at 3 AM UTC | `/api/cron/analytics-rollup` | Prune old snapshot events, aggregate analytics |

### Edge Middleware

The middleware (`middleware.js`) handles three route patterns:

1. **`/dpa-api/*`** — Proxies to DPA device on LAN (requires `DPA_DEVICE_API_TUNNEL` env var)
2. **`/dpa-upload/*`** — Proxies to device upload server (port 81)
3. **`/internal-api/*`** — Cloud API with:
   - Geo header injection (`x-dpa-region`)
   - Maintenance mode check (Edge Config → 503)
   - Portal announcement header (`x-dpa-announcement`)
   - Admin gate for fleet/firmware/devices/ingest routes (requires `dpa_operator_session` cookie)
   - Public path exemptions for device-facing endpoints

### Analytics Pipeline

```
Device (ESP32)                Portal (Angular)              Cloud (Vercel)
──────────────                ────────────────              ──────────────
firmware tracks               WiFi connect triggers         POST /analytics/events
play/skip/listen              → relayAnalyticsToCloud()     → Neon Postgres
counts on SD                    every 60s                   → device_events table
                              → cloudCheckIn()              
                                on connect                  GET /fleet/analytics
                                                            → aggregated KPIs
                                                            → top tracks
                                                            → activity feed
```
