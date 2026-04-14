# DPA Portal <-> ESP32 Firmware Integration Spec (Pre-Implementation)

## Purpose

Define the production contract and migration path to integrate:

- Creator Portal (`/artist/*`)
- Fan Portal (`/fan/*`)
- DPA ESP32 firmware (`firmware/dpa-esp32`)

This spec replaces simulator-driven behavior with live device-backed behavior while preserving current UX patterns.

---

## Scope

### In scope

- Endpoint-by-endpoint API contract between portal and firmware.
- Transport behavior for Wi-Fi-connected devices.
- Capsule/update delivery model to registered devices.
- Migration matrix from current mock/stub flows to production flows.
- Rollout checklist with phased risk control.

### Out of scope (this phase)

- BLE GATT protocol redesign.
- Full backend ledger/marketplace settlement implementation.
- Cryptographic redesign of `.dpa` package format.

---

## System Model

## Actors

- **Creator Portal**: authors themes, tracks, capsules, metadata.
- **Fan Portal**: playback control, favorites, device settings, capsule consumption.
- **Device (ESP32)**: runtime playback engine + SD content + local REST API.
- **Optional Cloud Backend**: registry, fan entitlements, creator analytics rollups.

## Connectivity Assumptions

- Device is reachable over Wi-Fi (AP `192.168.4.1` or STA IP).
- Portal talks directly to device HTTP API when on same network.
- Admin-gated actions require unlock via DUID.

---

## Canonical Data Ownership

- **Device-owned runtime state**
  - current track, play state, elapsed time
  - volume, EQ, playback mode
  - favorites set
  - SD storage and scanned playable media

- **Creator-owned authored state**
  - album metadata, booklet, pricing
  - theme definition
  - capsule definitions and publish schedule

- **Shared projection**
  - portal reads device runtime state and merges with creator metadata where needed.

---

## Delivery Model for Capsules/Updates

## Question to solve

How does a registered device receive creator packet updates over Wi-Fi?

## Required model (v1)

1. Creator publishes capsule/update in portal.
2. Portal posts payload to device endpoint while device is reachable:
   - `POST /api/capsule` (single packet)
3. Firmware stores capsule in ring buffer / list and surfaces in:
   - `GET /api/capsules`
   - status counters in `GET /api/status`
4. Fan portal polls `GET /api/capsules` and renders unread state.
5. Optional ack path for delivery/read state:
   - `POST /api/capsule/ack` (future)

## Offline behavior

- If device unreachable, portal queues publish intent in backend or local job queue.
- Retry when device reconnects (manual push now, automatic push in future).

---

## API Contract (Device-Facing)

All responses are JSON. `ok: boolean` is required for mutation endpoints.

## 1) Status and runtime

- `GET /api/status`
  - returns device identity, battery, audio/player status, storage, favorites, LED, DCNP colors.

Portal contract requirements:

- Keep `player` fields authoritative for playback UI.
- Treat missing optional fields defensively.

## 2) Playback commands

- `GET /api/cmd?op=<hex>`
  - `01` toggle play/pause
  - `02` pause/stop
  - `03` next
  - `04` previous
  - `60` volume up
  - `61` volume down

Contract rule:

- `op` must be sent as hex string semantics expected by firmware parser.

## 3) Track control

- `GET /api/track?i=<index>` play indexed track.
- `GET /api/audio/play?file=/tracks/file.wav`
- `GET /api/audio/stop`
- `GET /api/audio/seek?ms=<n>`
- `GET /api/audio/wavs` live scanned WAV inventory (canonical for SD files).

Contract rule:

- Fan/creator track listing should use `/api/audio/wavs` for real storage state.

## 4) Favorites

- `GET /api/favorites`
- `GET /api/favorites/set?file=<path>&state=true|false`
- `GET /api/favorites/toggle?file=<path>` (legacy)

Contract rule:

- Fan hearts must write through `/api/favorites/set` (idempotent).

## 5) Theme + LED

- `GET /api/led/preview?...`
- `POST /api/theme`

Payload (flat keys):

- `idle_color`, `idle_pattern`
- `play_color`, `play_pattern`
- `charge_color`, `charge_pattern`
- `brightness`
- `dcnp_concert`, `dcnp_video`, `dcnp_merch`, `dcnp_signing`, `dcnp_remix`, `dcnp_other`

## 6) Storage and uploads

- `GET /api/storage`
- `GET /api/sd/files?dir=/` (admin)
- `POST /api/sd/upload?path=/tracks/file.ext` (admin, multipart)
- `POST /api/sd/upload-raw?path=/tracks/file.ext` (admin)
- `DELETE /api/sd/delete?path=/tracks/file.ext` (admin)

Contract rule:

- Portal upload path must target `/api/sd/upload` not `/api/upload`.

## 7) Wi-Fi admin

- `GET /api/admin/unlock?key=<duid>`
- `GET /api/admin/lock`
- `GET /api/wifi/status`
- `GET /api/wifi/scan` (admin)
- `GET /api/wifi/connect?ssid=<>&pass=<>` (admin)
- `GET /api/wifi/disconnect` (admin)

## 8) Capsules (required for creator push)

- `GET /api/capsules` (already present)
- `POST /api/capsule` (required in this integration)
  - request:
    - `eventType`: `concert|video|merch|signing|remix|other`
    - `capsuleId`: string
    - `payload`: object (title/description/imageUrl/price/cta/metadata)
  - response:
    - `{ "ok": true, "id": "<capsuleId>" }`

Capsule payload caps (contract-locked for v1):

- Max request body for `POST /api/capsule`: `12KB` UTF-8 JSON.
- Max `payload.imageUrl` field: `8KB` UTF-8 string (prefer URL/file reference over inline base64 when larger).
- On over-limit payloads, portal must block send client-side and show actionable error.
- Firmware should reject oversized requests with non-`ok` response (recommended: `413` + `{ "ok": false, "error": "payload_too_large" }`).

---

## Type Alignment Rules

## Playback mode enum

- Firmware supports: `normal`, `repeat_one`.
- Portal UI type currently includes `repeat_all`, `shuffle`.

Rule:

- v1 UI only exposes firmware-supported modes.
- Future modes require firmware implementation first.

## EQ preset enum

- Firmware expects `bass_boost`.
- Portal currently uses `bass`.

Rule:

- Portal maps `bass -> bass_boost` for firmware requests.

## Status type strictness

- Portal `FirmwareStatus` must mark optional fields as optional if firmware may omit them.

---

## Migration Matrix

| Area | Current | Target | Action |
|---|---|---|---|
| Device library source | `populateMockLibrary()` from `DataService` | live from firmware scan/status | Replace mock population in Wi-Fi/BLE flows |
| Track list endpoint | `GET /api/tracks` (mock track structs) | `GET /api/audio/wavs` | Switch portal track source |
| Capsule push | portal calls `POST /api/capsule` but firmware lacks endpoint | real device ingest endpoint | Add firmware `POST /api/capsule` |
| Capsule list | `GET /api/capsules` static mock array | dynamic list including pushed packets | Back `GET /api/capsules` by runtime capsule store |
| Upload endpoint | portal uses `/api/upload` | firmware `/api/sd/upload` | Update portal upload method |
| Command encoding | portal sends numeric op as-is | explicit hex-compatible string | Normalize command mapping in portal service |
| EQ preset | portal `bass` | firmware `bass_boost` | Add mapping adapter |
| Playback modes | UI includes unsupported modes | UI constrained to supported | Gate mode options and API calls |
| Creator theme apply | saves to DataService only | push to device + persist authored source | Add creator-side device push action |
| Fleet tracker feed | synthetic random feed | backend/device event feed | Keep synthetic now; add pluggable provider interface |

---

## Rollout Checklist

## Phase 0: Contract lock

- [x] Finalize this spec and freeze endpoint names/payload keys.
- [x] Confirm admin unlock UX and DUID handling.
- [x] Confirm capsule payload size limits.

## Phase 1: Foundation alignment

- [x] Update portal service endpoints to firmware-implemented routes.
- [x] Normalize command op encoding for firmware parser expectations.
- [x] Add enum adapters for EQ/mode compatibility.
- [x] Replace fan/creator track source with `/api/audio/wavs` where device-bound.

## Phase 2: Capsule delivery

- [x] Implement firmware `POST /api/capsule`.
- [x] Persist in-memory list (and optional SD/NVS persistence).
- [x] Return pushed capsules via `GET /api/capsules`.
- [ ] Add unread/read state handling in fan portal.

## Phase 3: Creator push wiring

- [x] Wire creator Theme Editor push-to-device.
- [x] Wire creator Perks push success/error state to UI.
- [x] Add retry path for offline/unreachable device.

## Phase 4: Data replacement

- [x] Remove mock library injection in live transport paths.
- [x] Replace random fan play counts with firmware analytics endpoint.
- [x] Keep simulator mode only as explicit opt-in.

## Phase 5: Validation

- [x] Portal build passes.
- [x] Firmware build passes.
- [x] Manual Wi-Fi E2E:
  - creator pushes capsule
  - device receives packet
  - fan portal displays capsule
  - favorite + playback controls remain stable

## Phase 6: Cloud backend (added April 2026)

- [x] Neon Postgres for device registry, analytics events, operator sessions.
- [x] Upstash Redis for real-time device presence and session cache.
- [x] Vercel Blob for firmware binary storage.
- [x] Vercel Edge Config for feature flags, maintenance mode, firmware pointers.
- [x] Cron jobs for fleet health (5 min) and analytics rollup (daily).
- [x] Edge Middleware for admin gate, maintenance mode, geo headers.
- [x] Portal fleet tracker rewritten to consume live cloud analytics.
- [x] Device-to-cloud analytics relay (check-in on connect + 60s periodic).

---

## Risk Notes

- Frequent NVS writes from UI controls can cause wear and latency.
- ESP32 socket limits require conservative polling concurrency.
- Admin-gated endpoints need clear user feedback when locked.
- Payload size for images/base64 capsules should be constrained or moved to file references.

---

## Acceptance Criteria (Implementation Ready)

- A creator can push a capsule/update while device is connected on Wi-Fi.
- Device stores packet and exposes it through `GET /api/capsules`.
- Fan portal fetches and renders the new packet without mock fallback.
- Track/favorites/playback state reflect actual device storage/runtime data.
- No regression to existing playback, theme, or control APIs.
