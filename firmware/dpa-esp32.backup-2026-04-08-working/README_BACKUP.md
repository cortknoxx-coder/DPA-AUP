# DPA Firmware Snapshot — 2026-04-08 (working)

Full copy of `firmware/dpa-esp32/` at the point where the following were
**verified live on DPA-EB95**:

- `/api/theme` POST persists `artist` / `album` to NVS
- AP SSID auto-rebuilds to `<Artist>-<Album>-DPA` and **re-raises softAP live**
  (no reboot) when metadata changes
- `/api/status` exposes `artist`, `album`, `apSsid`
- Cover art upload via port 81 sync server → SD `/art/cover.jpg`
- Cover art served via `/api/art?path=/art/cover.jpg`
- Admin unlock via `/api/admin/unlock?key=<DUID>`
- LED rainbow + all Phase-4 patterns (breathing, pulse, comet, fire, etc.)
- Full Phase-4 dashboard.html (340 KB) intact

## Re-flashing this exact build

The prebuilt binary is preserved in `.pio/build/esp32s3/`. To restore:

```
BIN=$(dirname "$0")/.pio/build/esp32s3
python3 ~/.platformio/packages/tool-esptoolpy/esptool.py \
  --chip esp32s3 --port /dev/cu.usbmodem101 --baud 921600 \
  --before default_reset --after hard_reset write_flash -z \
  --flash_mode dio --flash_freq 80m --flash_size 8MB \
  0x0     $BIN/bootloader.bin \
  0x8000  $BIN/partitions.bin \
  0x10000 $BIN/firmware.bin
```

Pairs with portal snapshot: `backups/portal-2026-04-08-working/`

**DO NOT modify files in this folder.** Treat as read-only archive.
