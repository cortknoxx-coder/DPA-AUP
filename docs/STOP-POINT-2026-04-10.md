# DPA Stop Point — April 10, 2026

This document captures the current stop point after the latest portal, firmware,
and device validation work.

---

## What Landed

### Device dashboard (`192.168.4.1`)
- Repeating `Connection Lost` toast loop was fixed by adding poll stability and
  cooldown handling.
- Booklet pages now render fuller content structure, including liner notes,
  credits/details, lyrics, and explicit next/previous page controls.
- Booklet typography was reduced and cleaned up so it reads more premium and
  less oversized.
- The runtime HUD was moved away from the top hero area and restyled into a
  quieter product-style bottom status dock instead of a debug strip.
- Admin unlock flow remains available from the Device tab.

### Portal cover-art + sync wiring
- Cover-art sync logic was corrected so creator/fan surfaces no longer replace
  stored album artwork with a transient device URL.
- Device cover art can now be cached back into portal album state as a stable
  data URL during sync.
- Creator booklet preview and fan album detail now prefer stored synced artwork
  first, then device/live fallback.
- A non-breaking inline SVG default cover was added so fallback art can no
  longer disappear because of a missing asset path.

### Firmware / device data
- Firmware was rebuilt and flashed successfully to `/dev/cu.usbmodem101`.
- Device came back healthy after flash:
  - `bootState: ready`
  - `sdState: mounted`
  - `uploadState: idle`
- Direct device validation confirmed:
  - `/api/status` reachable
  - `/api/art?path=/art/cover.jpg` returns `200`
  - status reports real `coverBytes`
  - `/api/booklet` returns JSON
- `/api/album/meta` route exists in firmware, but the current validated device
  did not have the backing `album_meta.json` file on SD at the stop point.

---

## What Was Validated

### Builds
- `npm run build` passed after portal cover-art and fallback fixes.
- `./gen_dashboard.sh && pio run` passed after dashboard UI changes.

### Hardware flash
- Firmware upload succeeded multiple times during this pass with no build or
  flash failure.
- Post-flash direct polling confirmed the device returned to a healthy runtime
  state.

### Important distinction
- Direct device access from the host machine is working.
- Localhost creator/fan validation through the running dev server is still
  blocked by a proxy reachability problem from the Node/Vite process to
  `192.168.4.1`.

---

## Known Blockers

### 1. Local dev proxy cannot reliably reach the device
- Direct host requests to `http://192.168.4.1/...` succeed.
- The local dev server proxy for `http://127.0.0.1:4200/dpa-api/...` returns
  `500` / reachability errors.
- This prevents clean end-to-end localhost validation of creator/fan live sync
  even though the device itself is responding.

### 2. Device album meta file not present on SD
- Firmware route for `/api/album/meta` is present.
- Current flashed device returned `404` because the SD-backed metadata file was
  missing at validation time.
- Booklet JSON existed; album-meta JSON did not.

---

## Next Recommended Work

### Creator workflow
- Add a `Release Compile Preview` / preflight panel so the creator can see the
  full album package before rebuild.
- Add push verification/read-back so the portal confirms what actually landed on
  the device instead of only reporting request success.
- Scope immediate post-save refresh behavior to the creator portal only.

### Validation / reliability
- Fix the localhost dev proxy path so creator and fan routes can validate live
  device-backed data from the local app session.
- Re-validate creator and fan portals after the proxy issue is resolved.
- Re-save metadata from the creator portal once proxying is healthy so
  `album_meta.json` is written and `/api/album/meta` can be rechecked live.

---

## Current Recommended Resume Point

Resume with:
1. creator-side `Release Compile Preview`
2. creator-side push verification/read-back
3. localhost proxy/device reachability fix
4. end-to-end creator/fan live cover-art and metadata validation

---

## Checkpoint Refresh: Connection Hardening Validated

This refresh supersedes the earlier proxy blocker note in this stop point.

### What was fixed after the original stop point
- The portal WiFi path was hardened so status reads are shared/throttled instead
  of repeatedly duplicating `/api/status` traffic from multiple features.
- WiFi connect now prioritizes getting to a usable connected state first, then
  hydrates heavier metadata/art/booklet/capsule state in the background.
- Firmware status responses now explicitly send no-cache + close-connection
  headers to reduce stuck socket behavior on the ESP32 AP.

### What was validated live
- After a clean device replug, direct AP access recovered and stayed healthy:
  - `http://192.168.4.1/api/status` returned `200`
  - `http://192.168.4.1:81/api/status` returned `200`
  - both reported `bootState: ready`, `httpMode: full`, `duid: DPA-EB95`
- Local creator proxy path also recovered:
  - `http://127.0.0.1:4200/dpa-api/api/status` returned `200`
  - `http://127.0.0.1:4200/dpa-upload/api/status` returned `200`
- Stress validation of the proxied status path passed `15/15` requests cleanly.
- Creator portal behavior on live hardware now matches the intended UX:
  - with the device already connected to the local AP, the portal opened already
    connected
  - the creator status control showed `WiFi Direct` immediately
  - `Detect Current Connection` preserved the active session without error

### Updated blocker state
- The earlier localhost proxy blocker is no longer the active stop-point blocker.
- The main remaining live-connection gaps are:
  - USB-C bridge validation after the new connection-manager changes
  - NFC connection validation on supported Android Chrome hardware
  - creator preflight/read-back workflow not yet built

### Updated resume point
Resume with:
1. USB-C live validation against the hardened connection flow
2. NFC live validation
3. creator-side `Release Compile Preview`
4. creator-side push verification/read-back
