## Hosted Portal Device Sync Matrix

This document defines the expected separation and validation flow for the DPA hosted portal versus the on-device UI.

### Surface model

| Surface | URL | Responsibility |
| --- | --- | --- |
| Fan/Creator Portal | `https://dpa-aup-portal.vercel.app` | Cloud-hosted Angular app for fan and creator flows |
| Device UI | `http://192.168.4.1` | Independent on-device dashboard and device REST API while connected to the DPA AP |

The portal is not the device UI. The portal may proxy to the device API for control, uploads, and SD-backed state sync, but the hardware dashboard remains on `192.168.4.1`.

### Required Vercel environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `DPA_DEVICE_API_TUNNEL` | Yes | HTTPS tunnel or gateway that forwards to the device main API on `http://192.168.4.1` |
| `DPA_DEVICE_UPLOAD_TUNNEL` | Usually | HTTPS tunnel or gateway that forwards to the upload plane on `http://192.168.4.1:81` |
| `DPA_INTERNAL_API_BASE` | For cloud ingest | Internal ingest/operator API base URL |
| `DPA_BRIDGE_WS_URL` | Optional | Desktop bridge websocket URL |
| `DPA_API_BASE_URL` | Optional | Cloud API base URL for non-device portal services |

If `DPA_DEVICE_API_TUNNEL` is missing, hosted `/dpa-api/*` must be treated as unconfigured and cannot be expected to reach the device.

### Pass/fail matrix

| Check | Expected result | Status |
| --- | --- | --- |
| `GET /dpa-api/api/status` from Vercel | Device JSON, not SPA HTML | Pending |
| `GET /dpa-api/api/storage` from Vercel | SD/storage JSON | Pending |
| `GET /dpa-api/api/capsules` from Vercel | Capsule JSON from device runtime/SD | Pending |
| `GET /dpa-upload/api/status` from Vercel | Upload-plane JSON | Pending |
| Device connect in hosted portal | Live status, no endless retry loop | Pending |
| Theme/perk sync | `POST /api/theme` succeeds and `status.dcnp.*` reads back | Pending |
| SD inventory sync | Track counts and storage match device | Pending |
| Capsule OTA surfaces | Portal reflects installed and unseen capsules | Pending |
| Direct AP soak on `192.168.4.1` | Capsule/perk/device API checks pass | Passed |
| Firmware flash over USB | Firmware uploads successfully over `/dev/cu.usbmodem101` | Passed |
| Node OTA contract tests | `internal-ingest-api/capsule-ota.test.mjs` passes | Passed |

### Validation order

1. Deploy the latest repo state to Vercel.
2. Set `DPA_DEVICE_API_TUNNEL` and `DPA_DEVICE_UPLOAD_TUNNEL`.
3. Verify hosted `/dpa-api/api/status` returns device JSON.
4. Verify hosted `/dpa-api/api/storage` and `/dpa-api/api/capsules`.
5. Verify hosted uploads through `/dpa-upload`.
6. Verify theme/perk readback and capsule surfaces.
7. Run the capsule/perks soak against the hosted path after proxy validation.

### Current known blocker

The Vercel project currently has no configured environment variables, so hosted proxy paths cannot yet reach the device end to end.
