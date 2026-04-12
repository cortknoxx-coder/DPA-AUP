# Capsule OTA Validation Matrix

## Purpose

Define the end-to-end validation path for capsule OTA before rollout.

This document is implementation-facing. It assumes the contract in `docs/CAPSULE_OTA_CONTRACT.md`.

## Validation Principles

- Validate from backend to SD install, not just API success.
- Prefer readback verification over optimistic UI updates.
- Treat `installed` as the first user-visible success state.
- Keep one capsule under test at a time until the basic path is stable.

---

## Test Environment

## Required Components

- local/operator backend running `internal-ingest-api/server.mjs`
- one real DPA on STA-capable firmware
- one real browser session for fan portal
- one registered device token
- at least one small test capsule payload on disk

## Suggested Test Fixture Capsule

- `capsuleId`: `cap_smoke_001`
- `albumId`: `the-wack-game`
- payload size: under `2 MB`
- type: `audio` or lightweight `note`

---

## Phase 1: Backend Model Validation

## 1. Device registration

Check:

- operator can register a device
- device token is returned once
- backend persists `lastSeenAt`

Pass conditions:

- `POST /internal-api/devices/register` returns `ok: true`
- device appears in `GET /internal-api/devices`

## 2. Entitlement creation

Check:

- entitlement is bound to the correct `deviceId`
- delivery record is initialized as `pending`

Pass conditions:

- backend returns exactly one pending delivery for the test device
- no other device sees that delivery

## 3. Public summary safety

Check:

- public summary does not expose tokens, paths, signed URLs, or internal filenames

Pass conditions:

- summary includes only aggregate counts and timestamps

---

## Phase 2: Device Check-In Validation

## 4. Authenticated check-in

Action:

- device calls `POST /internal-api/device/check-in`

Pass conditions:

- invalid token returns `403`
- valid token returns `ok: true`
- backend updates `lastSeenAt`
- response includes only the device’s pending capsules

## 5. Empty queue behavior

Action:

- call check-in with no pending capsules

Pass conditions:

- response returns `pendingCount: 0`
- firmware returns to `idle`
- no LED notification

---

## Phase 3: Download and Install Validation

## 6. Download announce

Action:

- device accepts the pending capsule

Pass conditions:

- backend moves delivery from `pending` to `announced`
- firmware state moves to `announced`

## 7. Partial download handling

Action:

- interrupt download mid-transfer

Pass conditions:

- `.part` file remains temporary only
- backend status becomes `failed` or remains retry-eligible
- final installed path is not created

## 8. Checksum verification

Action:

- complete download with intentional checksum mismatch

Pass conditions:

- firmware rejects install
- backend delivery becomes `failed`
- final file is not present
- unread count does not increase

## 9. Successful install

Action:

- complete download with valid size and checksum

Pass conditions:

- final file exists on SD
- `/capsules/index.json` includes the capsule
- backend delivery becomes `installed`
- firmware state returns to `idle`
- LED arrival pattern fires once

## 10. Duplicate suppression

Action:

- check-in again with same `capsuleId` and same `version`

Pass conditions:

- backend does not redeliver
- device does not duplicate SD content

---

## Phase 4: Fan Portal Validation

## 11. Cloud-only view

Action:

- disconnect device, open fan portal

Pass conditions:

- portal shows queued/downloading/installed summary from public backend state
- portal does not expose internal URLs or operator metadata

## 12. Live device merge

Action:

- reconnect device, open fan portal

Pass conditions:

- portal prefers live device-installed truth over stale cloud assumptions
- unread capsule appears as `New on device`

## 13. Seen/opened behavior

Action:

- open the capsule on device or connected fan portal

Pass conditions:

- backend status becomes `seen`
- LED reminder clears
- fan portal removes unread emphasis

---

## Phase 5: Failure and Recovery Validation

## 14. Low storage

Action:

- force low free-space condition

Pass conditions:

- firmware reports `storage_insufficient`
- backend marks delivery `failed`
- no partial install remains

## 15. STA disconnect during transfer

Action:

- drop STA during download

Pass conditions:

- device exits to `error`
- retry remains possible
- no final installed file is created

## 16. Reboot recovery

Action:

- reboot during `.part` download and again after successful install

Pass conditions:

- stale `.part` is cleaned or ignored safely
- installed capsule remains indexed after reboot

---

## Firmware Validation Hooks

Add or verify:

- serial logs for state transitions
- `/api/status.capsuleOta`
- last error code
- current delivery id
- pending and unseen counts

Minimum runtime evidence to capture during each test:

- backend delivery status before and after
- firmware `/api/status`
- SD file presence
- fan portal rendered state

---

## Suggested Smoke Script Sequence

Initial manual sequence:

1. Register device.
2. Seed one entitlement.
3. Call device check-in.
4. Confirm pending capsule returned.
5. Download to `.part`.
6. Verify checksum.
7. Rename/install to final SD path.
8. Report `complete`.
9. Confirm fan portal shows `New on device`.
10. Open capsule and confirm `seen`.

---

## Exit Criteria for MVP

MVP is ready when all of the following are true:

- one real DPA can check in and receive a pending capsule
- download completes to SD with checksum verification
- installed capsule survives reboot
- fan portal shows installed and unread state correctly
- opening the capsule clears unread state
- low-storage and interrupted-download failures do not corrupt final state

## Nice-to-Have Before Broad Rollout

- automated backend API smoke tests
- automated contract tests for device token rejection
- hardware soak test with repeated check-in/download/install cycles
- multi-device entitlement isolation test
