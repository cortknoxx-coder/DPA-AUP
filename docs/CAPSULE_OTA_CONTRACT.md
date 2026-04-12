# Capsule OTA Contract

## Purpose

Define the concrete backend, device, and portal contract for **capsule OTA delivery** on the DPA platform.

This contract is for **content OTA to SD storage**, not firmware OTA to flash.

It builds on the current private ingest/operator architecture:

- `internal-ingest-api/server.mjs`
- `firmware/dpa-esp32/dpa_ingest.h`
- `src/services/private-ingest.service.ts`

## Goals

- Deliver purchased or granted capsules to a registered DPA over STA Wi-Fi.
- Keep firmware/application flash separate from capsule/content delivery.
- Track delivery per device with explicit lifecycle states.
- Surface safe status to fan/creator portals without exposing raw operator tooling.

## Non-Goals

- Remote firmware upgrade.
- Marketplace billing/settlement implementation.
- Full cryptographic redesign of `.dpa` payloads.

---

## System Roles

- `Operator backend`
  - owns device registrations, entitlements, delivery queue, signed download URLs, and delivery status
- `DPA device`
  - authenticates with device token, checks for pending capsules, downloads payloads to SD, verifies, installs, and reports state
- `Fan portal`
  - shows cloud queue state, device-installed state, and unread/opened state
- `Creator portal`
  - can see safe aggregate delivery/readiness state but does not manage device tokens directly

---

## Canonical Data Model

## 1. Devices

Persisted in backend.

```json
{
  "id": "dev_01",
  "deviceId": "DPA-EB95",
  "label": "Cort Knoxx main unit",
  "albumId": "the-wack-game",
  "tokenHash": "sha256(...)",
  "createdAt": "2026-04-10T22:00:00.000Z",
  "updatedAt": "2026-04-10T22:00:00.000Z",
  "lastSeenAt": "2026-04-10T22:15:00.000Z"
}
```

## 2. Capsule Catalog

Authoritative definition of what can be delivered.

```json
{
  "id": "cap_002",
  "albumId": "the-wack-game",
  "type": "audio",
  "title": "After Hours Remix",
  "description": "Bonus late-night remix drop.",
  "version": 1,
  "payloadKind": "dpa",
  "payloadSha256": "2f5b...",
  "payloadSizeBytes": 4822193,
  "payloadUrl": "signed-or-internal-url",
  "artworkUrl": "https://...",
  "ledIntent": "capsule_arrival",
  "createdAt": "2026-04-10T22:00:00.000Z",
  "updatedAt": "2026-04-10T22:00:00.000Z"
}
```

## 3. Capsule Entitlements

Who should receive the capsule.

```json
{
  "id": "ent_002",
  "capsuleId": "cap_002",
  "userId": "fan_001",
  "deviceId": "DPA-EB95",
  "albumId": "the-wack-game",
  "sourceType": "purchase",
  "priority": "normal",
  "availableAt": "2026-04-10T22:05:00.000Z",
  "expiresAt": null,
  "createdAt": "2026-04-10T22:05:00.000Z"
}
```

## 4. Capsule Deliveries

Per-device delivery lifecycle.

```json
{
  "id": "del_002",
  "entitlementId": "ent_002",
  "capsuleId": "cap_002",
  "deviceId": "DPA-EB95",
  "albumId": "the-wack-game",
  "status": "pending",
  "attemptCount": 0,
  "progressBytes": 0,
  "installedPath": "",
  "lastError": "",
  "announcedAt": null,
  "downloadStartedAt": null,
  "downloadCompletedAt": null,
  "installedAt": null,
  "seenAt": null,
  "updatedAt": "2026-04-10T22:05:00.000Z"
}
```

## Allowed Delivery Status Values

- `pending`
- `announced`
- `downloading`
- `downloaded`
- `verifying`
- `installed`
- `seen`
- `failed`
- `expired`

---

## Backend API Contract

All device-facing routes live under `internal-api`, matching the current operator/ingest service.

Device authentication uses:

- header: `X-DPA-Device-Token`

Device identifiers use:

- `deviceId` equal to the DPA serial / DUID

## 1. Device Check-In

### `POST /internal-api/device/check-in`

Primary polling endpoint. Returns pending capsule work for a device.

Request:

```json
{
  "deviceId": "DPA-EB95",
  "firmwareVersion": "2.4.1",
  "albumIds": ["the-wack-game"],
  "installedCapsules": [
    { "capsuleId": "cap_001", "version": 1, "seen": true }
  ],
  "freeStorageMb": 1402,
  "batteryPercent": -1,
  "wifiRssi": 0
}
```

Success response:

```json
{
  "ok": true,
  "deviceId": "DPA-EB95",
  "serverTime": "2026-04-10T22:20:00.000Z",
  "pendingCount": 1,
  "capsules": [
    {
      "deliveryId": "del_002",
      "entitlementId": "ent_002",
      "capsuleId": "cap_002",
      "albumId": "the-wack-game",
      "title": "After Hours Remix",
      "description": "Bonus late-night remix drop.",
      "type": "audio",
      "version": 1,
      "payloadKind": "dpa",
      "payloadSha256": "2f5b...",
      "payloadSizeBytes": 4822193,
      "downloadUrl": "https://signed.example/capsules/cap_002.dpa",
      "installPath": "/capsules/cap_002_v1.dpa",
      "artworkUrl": "https://...",
      "ledIntent": "capsule_arrival"
    }
  ]
}
```

Failure responses:

- `403`

```json
{ "ok": false, "error": "device token rejected" }
```

- `409`

```json
{ "ok": false, "error": "device not registered" }
```

Rules:

- Backend updates `lastSeenAt` for the device on every successful check-in.
- Backend should suppress already-installed same-version capsules.
- Backend should return capsules sorted by priority, then `availableAt`.

## 2. Delivery Announcement

### `POST /internal-api/device/capsules/:deliveryId/announce`

Marks that the device has accepted responsibility to fetch the capsule.

Request:

```json
{
  "deviceId": "DPA-EB95",
  "capsuleId": "cap_002"
}
```

Response:

```json
{
  "ok": true,
  "deliveryId": "del_002",
  "status": "announced",
  "updatedAt": "2026-04-10T22:20:03.000Z"
}
```

## 3. Download Progress

### `POST /internal-api/device/capsules/:deliveryId/progress`

Request:

```json
{
  "deviceId": "DPA-EB95",
  "capsuleId": "cap_002",
  "status": "downloading",
  "progressBytes": 2097152,
  "totalBytes": 4822193
}
```

Response:

```json
{
  "ok": true,
  "deliveryId": "del_002",
  "status": "downloading",
  "progressBytes": 2097152,
  "updatedAt": "2026-04-10T22:20:09.000Z"
}
```

## 4. Download Complete / Verify Start

### `POST /internal-api/device/capsules/:deliveryId/downloaded`

Request:

```json
{
  "deviceId": "DPA-EB95",
  "capsuleId": "cap_002",
  "sha256": "2f5b...",
  "sizeBytes": 4822193,
  "tempPath": "/capsules/.cap_002_v1.part"
}
```

Response:

```json
{
  "ok": true,
  "deliveryId": "del_002",
  "status": "verifying"
}
```

## 5. Install Complete

### `POST /internal-api/device/capsules/:deliveryId/complete`

Request:

```json
{
  "deviceId": "DPA-EB95",
  "capsuleId": "cap_002",
  "installedPath": "/capsules/cap_002_v1.dpa",
  "sha256": "2f5b...",
  "sizeBytes": 4822193
}
```

Response:

```json
{
  "ok": true,
  "deliveryId": "del_002",
  "status": "installed",
  "installedAt": "2026-04-10T22:20:15.000Z"
}
```

## 6. Delivery Failure

### `POST /internal-api/device/capsules/:deliveryId/fail`

Request:

```json
{
  "deviceId": "DPA-EB95",
  "capsuleId": "cap_002",
  "status": "failed",
  "error": "checksum_mismatch"
}
```

Response:

```json
{
  "ok": true,
  "deliveryId": "del_002",
  "status": "failed",
  "retryEligible": true
}
```

Allowed `error` values:

- `device token rejected`
- `storage_insufficient`
- `download_failed`
- `checksum_mismatch`
- `rename_failed`
- `install_index_failed`
- `unsupported_payload`
- `sta_not_connected`

## 7. Seen / Read Ack

### `POST /internal-api/device/capsules/:deliveryId/seen`

Sent when the fan opens the capsule on the DPA or via a live-connected fan portal.

Request:

```json
{
  "deviceId": "DPA-EB95",
  "capsuleId": "cap_002"
}
```

Response:

```json
{
  "ok": true,
  "deliveryId": "del_002",
  "status": "seen",
  "seenAt": "2026-04-10T22:23:00.000Z"
}
```

## 8. Public Fan-Safe Summary

### `GET /internal-api/public/capsules/summary?albumId=the-wack-game&deviceId=DPA-EB95`

Response:

```json
{
  "ok": true,
  "summary": {
    "albumId": "the-wack-game",
    "deviceId": "DPA-EB95",
    "pending": 1,
    "downloading": 0,
    "installed": 3,
    "unseen": 1,
    "failed": 0,
    "lastInstalledAt": "2026-04-10T22:20:15.000Z"
  }
}
```

---

## Firmware-Side Capsule OTA State Machine

Recommended device runtime variable:

- `g_capsuleOtaState`

Recommended values:

- `disabled`
- `idle`
- `checking`
- `announced`
- `downloading`
- `verifying`
- `installing`
- `installed`
- `error`

## Transition Rules

```text
disabled
  -> idle                 when backend base URL + device token + STA are ready

idle
  -> checking             on poll interval or manual refresh

checking
  -> idle                 when no pending capsules are returned
  -> announced            when backend returns at least one capsule and device accepts it
  -> error                on auth/network/protocol failure

announced
  -> downloading          when download begins
  -> error                if local preflight fails

downloading
  -> verifying            when download completes to .part file
  -> error                on network/storage failure

verifying
  -> installing           when checksum and size match
  -> error                on checksum/size mismatch

installing
  -> installed            when final rename + local index update succeed
  -> error                on rename/index failure

installed
  -> idle                 after LED notify + next scheduler tick

error
  -> idle                 after backoff window expires or manual retry
```

## Firmware Local SD Rules

Storage layout:

- `/capsules/index.json`
- `/capsules/.cap_002_v1.part`
- `/capsules/cap_002_v1.dpa`
- `/capsules/art/cap_002.jpg`

Install rules:

- Always write to `.part` first.
- Never mark installed until checksum passes.
- Rename atomically to final path.
- Update local index only after rename succeeds.
- Delete stale `.part` files on boot or before next retry.
- Process one pending capsule at a time.

## Firmware Polling Rules

- Poll only when `g_staConnected == true`.
- Default poll interval:
  - `idle`: every 5 minutes
  - `recent activity`: every 30 seconds for 5 minutes after install/failure
- Do not poll while a large manual upload is in `preparing|receiving|verifying|finalizing`.

## Recommended Firmware Status Additions

Add to `/api/status`:

```json
{
  "capsuleOta": {
    "configured": true,
    "state": "idle",
    "lastError": "",
    "currentDeliveryId": "",
    "currentCapsuleId": "",
    "lastInstalledAt": 1712442015,
    "pendingCount": 1,
    "unseenCount": 1
  }
}
```

---

## Fan Portal Behavior Contract

## Home / Capsule Inbox

Display layers:

- cloud queue state from `public/capsules/summary`
- live device state when connected to a DPA
- unread/opened state

Priority:

1. Live device-installed truth when the DPA is connected.
2. Public cloud summary when device is not connected.

## UI Labels

- `Queued for your DPA`
- `Downloading to device`
- `Installed on your DPA`
- `New on device`
- `Opened`
- `Delivery failed`

## Merge Rules

- `pending + not installed` -> show queued state
- `installed + unseen` -> show new state and keep capsule highlighted
- `seen` -> normal capsule display
- `failed` -> soft warning, no celebratory LED language

---

## LED Notification Contract

Arrival behavior:

- Trigger a short arrival animation only after `installed`.
- Do not run celebratory animation on `downloaded` or `verifying`.
- Do not interrupt active playback with a long or aggressive pattern.

Recommended patterns:

- `capsule_arrival`
  - 2-3 second soft pulse/sparkle in capsule accent color
- `capsule_unseen_reminder`
  - subtle idle-only reminder, low frequency, suppressed during playback

Clear behavior:

- When capsule becomes `seen`, unread reminder stops.

---

## Security Rules

- Device token is required for all device capsule endpoints.
- Download URLs should be signed and short-lived when externalized.
- Backend must scope capsule responses to the authenticated `deviceId`.
- Device must verify `sha256` and file size before install.
- Device must not trust title/type/install path without server-side delivery linkage.

---

## Implementation Order

1. Extend backend state model with `capsules`, `entitlements`, `deliveries`.
2. Add `POST /internal-api/device/check-in`.
3. Add delivery mutation endpoints.
4. Add firmware capsule OTA state machine and SD install path.
5. Expose `capsuleOta` in `/api/status`.
6. Add public fan-safe summary endpoint.
7. Update fan portal to merge cloud + live device state.
