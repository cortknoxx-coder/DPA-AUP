/*
 * DPA Player — library scanner
 * Maintains an in-memory list of playable tracks found under
 * /sd/tracks. Supports .dpa (native container), .flac, and .wav.
 *
 * In DPA_PLAYER_SIM_LIBRARY / DPA_PLAYER_SIM_MODE the scanner seeds
 * a canned set of tracks so the Angular portal can be iterated on
 * before any SD card / FLAC files exist on disk.
 */

#ifndef DPA_PLAYER_LIBRARY_H
#define DPA_PLAYER_LIBRARY_H

#include <stdint.h>
#include <stdbool.h>

#include "esp_err.h"
#include "config.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Payload kinds the library understands. Keep in sync with the
 * extensions handled in library_scan_dir() — .dpa files report
 * their embedded payload format as reported by dpa_format. */
typedef enum {
    DPA_TRACK_KIND_UNKNOWN = 0,
    DPA_TRACK_KIND_DPA,   /* .dpa (DPA1 container, native) */
    DPA_TRACK_KIND_FLAC,  /* .flac */
    DPA_TRACK_KIND_WAV,   /* .wav  */
} dpa_track_kind_t;

typedef struct {
    uint32_t         id;                  /* stable within scan */
    char             path[160];           /* absolute path ("/sd/tracks/..") */
    char             title[96];           /* display title */
    char             artist[64];          /* optional */
    char             album[64];           /* optional */
    uint32_t         duration_ms;
    uint32_t         sample_rate;         /* Hz */
    uint16_t         channels;
    uint16_t         bits_per_sample;
    uint32_t         payload_size;        /* audio bytes (excl. header) */
    dpa_track_kind_t kind;
    bool             simulated;           /* true when backed by canned data */
} dpa_track_t;

/* Top-level init. Scans the SD card under DPA_PLAYER_LIBRARY_ROOT
 * and builds the in-memory track index. Safe to call even when the
 * SD is not mounted / SIM mode is on — that path falls back to the
 * seeded fake catalog. Always returns ESP_OK. */
esp_err_t dpa_library_init(void);

/* Rescans the library, replacing the in-memory index. Returns the
 * number of tracks found (>= 0). */
int  dpa_library_rescan(void);

/* Accessor — returns the raw track array and its length. Valid
 * until the next dpa_library_rescan(). Never NULL; count may be 0. */
const dpa_track_t *dpa_library_tracks(size_t *out_count);

/* Looks up a track by 1-based index (matches JSON order). Returns
 * NULL for out-of-range. */
const dpa_track_t *dpa_library_get(size_t index);

/* Looks up a track by id. Returns NULL if not found. */
const dpa_track_t *dpa_library_find_by_id(uint32_t id);

/* Returns a short ASCII label for a track kind, e.g. "FLAC". */
const char *dpa_library_kind_name(dpa_track_kind_t k);

#ifdef __cplusplus
}
#endif

#endif /* DPA_PLAYER_LIBRARY_H */
