# DPA Creator/Fan Portal Snapshot — 2026-04-08 (working)

Paired with `firmware/dpa-esp32.backup-2026-04-08-working/`.

Files in this snapshot:
- `src/services/device-wifi.service.ts`   — dev proxy support, pullMetadata,
                                             verifyCoverArt, /api/art endpoint,
                                             port-81 uploads via /dpa-upload
- `src/services/data.service.ts`          — quota-safe stripHeavyFields
- `src/pages/album-metadata/album-metadata.component.ts`
                                             — auto-sync from device, drift
                                             banner, verified-on-device chip,
                                             thumbnail downscale
- `angular.json`                          — proxyConfig: proxy.conf.json
- `proxy.conf.json`                       — /dpa-api → :80, /dpa-upload → :81

## Known good when paired with the matching firmware snapshot
- Metadata push + live SSID swap without reboot
- Cover art upload (port 81) + verification via /api/art
- Dashboard cards render device-hosted artwork
- Audio track upload via port 81 sync server

**DO NOT modify files in this folder.** Treat as read-only archive.
