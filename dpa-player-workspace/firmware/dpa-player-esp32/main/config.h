/*
 * DPA Player — project-wide configuration constants
 * --------------------------------------------------
 * Every magic number (IP, SSID, ports, timeouts) that Player firmware
 * cares about is defined here so no module needs to hardcode strings.
 */

#ifndef DPA_PLAYER_CONFIG_H
#define DPA_PLAYER_CONFIG_H

#ifdef __cplusplus
extern "C" {
#endif

/* ------------------------------------------------------------------
 * Network isolation from the DPA Album sibling product
 * ------------------------------------------------------------------
 * DPA Album lives on 192.168.4.1 with SSID prefix "DPA-".
 * DPA Player lives on 192.168.5.1 with SSID prefix "DPA-Player-".
 * These MUST NOT collide so a fan with both devices can run them
 * simultaneously on separate phone connections.
 */
#define DPA_PLAYER_AP_IP       "192.168.5.1"
#define DPA_PLAYER_AP_GW       "192.168.5.1"
#define DPA_PLAYER_AP_NETMASK  "255.255.255.0"

/* SoftAP identity. Last 4 hex of MAC is appended at runtime so two
 * Players on the same tabletop don't clash. */
#define DPA_PLAYER_SSID_PREFIX "DPA-Player-"

/* Open AP for captive portal UX. Phase 7 may add optional WPA2. */
#define DPA_PLAYER_AP_OPEN     1
#define DPA_PLAYER_AP_PASSWORD ""

#define DPA_PLAYER_AP_CHANNEL      6
#define DPA_PLAYER_AP_MAX_CLIENTS  4

/* mDNS / HTTP */
#define DPA_PLAYER_HOSTNAME   "dpa-player"
#define DPA_PLAYER_HTTP_PORT  80
#define DPA_PLAYER_DNS_PORT   53

/* Upload server lives on its own httpd instance so the main API
 * thread isn't blocked by multi-MB FLAC uploads. */
#define DPA_PLAYER_UPLOAD_HTTP_PORT 81

/* ------------------------------------------------------------------
 * SD card (SPI) — Waveshare ESP32-S3 Zero wiring
 * ------------------------------------------------------------------
 * Matches the DPA Album harness so the same physical adapter
 * works on both devices. Change in one place if your board differs.
 */
#define DPA_PLAYER_SD_MOUNT      "/sd"
#define DPA_PLAYER_SD_PIN_CS     10
#define DPA_PLAYER_SD_PIN_MOSI   11
#define DPA_PLAYER_SD_PIN_SCK    12
#define DPA_PLAYER_SD_PIN_MISO   13

/* SPI clock — 400 kHz during init, 20 MHz for audio read.
 * The slow speed matches the SDSPI init sequence; the fast speed
 * is the proven ceiling on the Album hardware. */
#define DPA_PLAYER_SD_FREQ_SLOW_KHZ     400
#define DPA_PLAYER_SD_FREQ_FAST_KHZ   20000

/* Default library root under the SD mount. The scanner walks this
 * recursively up to DPA_PLAYER_LIBRARY_MAX_DEPTH levels. Uploads
 * land in DPA_PLAYER_UNSORTED_DIR until the user tags them. */
#define DPA_PLAYER_LIBRARY_ROOT       "/tracks"
#define DPA_PLAYER_UNSORTED_DIR       "/tracks/unsorted"
#define DPA_PLAYER_LIBRARY_MAX_DEPTH  3
#define DPA_PLAYER_LIBRARY_MAX_TRACKS 256

#ifdef __cplusplus
}
#endif

#endif /* DPA_PLAYER_CONFIG_H */
