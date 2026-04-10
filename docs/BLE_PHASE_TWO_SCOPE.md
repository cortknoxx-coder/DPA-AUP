# BLE Phase Two Scope

BLE remains a second-phase fallback after WiFi boot and upload reliability.

## Constraints

- BLE is control-only: play, pause, next, previous, volume, and lightweight status.
- BLE is not an upload transport.
- BLE does not own library sync, cover art, booklet transfer, or marketplace data.
- Physical GPIO buttons remain authoritative and unchanged as the hard local fallback.

## Integration Rules

- BLE commands should converge on the same playback/control handlers used by the HTTP command path.
- Upload state blocks playback starts regardless of transport so SD writes stay protected.
- Any future BLE firmware work must be gated on measured heap headroom after the reliability pass.
