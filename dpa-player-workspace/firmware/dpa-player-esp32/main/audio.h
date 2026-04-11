/*
 * DPA Player — audio transport
 * Owns the current track, playback position, and transport state
 * (play / pause / stop). In SIM mode a background task advances
 * position_ms in real time without ever touching I2S or a decoder.
 *
 * Phase 4 will replace the SIM advance with a real dr_flac + i2s_std
 * pipeline; the public API stays stable so the HTTP layer and the
 * Angular portal don't change between sim and real.
 */

#ifndef DPA_PLAYER_AUDIO_H
#define DPA_PLAYER_AUDIO_H

#include <stdint.h>
#include <stdbool.h>

#include "esp_err.h"
#include "library.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    DPA_AUDIO_STOPPED = 0,
    DPA_AUDIO_PLAYING,
    DPA_AUDIO_PAUSED,
} dpa_audio_state_t;

typedef enum {
    DPA_REPEAT_OFF = 0,
    DPA_REPEAT_ONE,
    DPA_REPEAT_ALL,
} dpa_repeat_mode_t;

typedef struct {
    dpa_audio_state_t state;
    uint32_t          track_id;        /* 0 if none */
    uint32_t          position_ms;
    uint32_t          duration_ms;
    uint8_t           volume;          /* 0..100 */
    bool              shuffle;
    dpa_repeat_mode_t repeat;
    bool              simulated;       /* mirrors DPA_PLAYER_SIM_AUDIO */
} dpa_audio_status_t;

/* Starts the transport subsystem. Spawns the SIM tick task when
 * DPA_PLAYER_SIM_AUDIO is on. Always returns ESP_OK. */
esp_err_t dpa_audio_start(void);

/* Transport controls. All are idempotent. track_id=0 on play means
 * "resume current / start first track in the library". */
esp_err_t dpa_audio_play(uint32_t track_id);
esp_err_t dpa_audio_pause(void);
esp_err_t dpa_audio_stop(void);
esp_err_t dpa_audio_next(void);
esp_err_t dpa_audio_prev(void);

/* Seek absolute. Clamped to [0, duration_ms]. */
esp_err_t dpa_audio_seek(uint32_t ms);

/* Settings. */
esp_err_t dpa_audio_set_volume(uint8_t v);
esp_err_t dpa_audio_set_shuffle(bool on);
esp_err_t dpa_audio_set_repeat(dpa_repeat_mode_t m);

/* Snapshot. Always safe; thread-safe via a lightweight mutex. */
void dpa_audio_get_status(dpa_audio_status_t *out);

/* Returns the currently loaded track, or NULL if STOPPED. */
const dpa_track_t *dpa_audio_current_track(void);

#ifdef __cplusplus
}
#endif

#endif /* DPA_PLAYER_AUDIO_H */
