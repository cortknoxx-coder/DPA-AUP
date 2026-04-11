/*
 * DPA Player — audio transport (simulation-first)
 * --------------------------------------------------
 * Phase 4 will add dr_flac + i2s_std under this API. Until then,
 * the transport runs purely in software:
 *   - track selection hits the library index
 *   - play/pause/seek/volume mutate in-memory state
 *   - a FreeRTOS tick task advances position_ms while PLAYING and
 *     auto-transitions at end-of-track according to repeat mode
 *
 * Everything the portal needs (/api/player/*, /api/status) reads
 * from dpa_audio_get_status() so the UI will look "played" even
 * without a DAC wired up.
 */

#include "audio.h"
#include "config.h"
#include "library.h"

#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "esp_log.h"
#include "esp_timer.h"

static const char *TAG = "audio";

static SemaphoreHandle_t  s_lock = NULL;
static dpa_audio_status_t s_st   = {
    .state       = DPA_AUDIO_STOPPED,
    .volume      = 70,
    .shuffle     = false,
    .repeat      = DPA_REPEAT_OFF,
    .simulated   = (bool)DPA_PLAYER_SIM_AUDIO,
};
static const dpa_track_t *s_current = NULL;

#define LOCK()   xSemaphoreTake(s_lock, portMAX_DELAY)
#define UNLOCK() xSemaphoreGive(s_lock)

/* ---------- internals (caller holds lock) --------------------------- */

static const dpa_track_t *find_first_track(void)
{
    size_t n = 0;
    const dpa_track_t *all = dpa_library_tracks(&n);
    return (n > 0) ? &all[0] : NULL;
}

static void load_track_locked(const dpa_track_t *t)
{
    s_current = t;
    if (!t) {
        s_st.track_id    = 0;
        s_st.duration_ms = 0;
        s_st.position_ms = 0;
        s_st.state       = DPA_AUDIO_STOPPED;
        return;
    }
    s_st.track_id    = t->id;
    s_st.duration_ms = t->duration_ms;
    s_st.position_ms = 0;
    ESP_LOGI(TAG, "load track #%u \"%s\" (%u ms)",
             (unsigned)t->id, t->title, (unsigned)t->duration_ms);
}

static void advance_track_locked(int dir)
{
    size_t n = 0;
    const dpa_track_t *all = dpa_library_tracks(&n);
    if (n == 0) {
        load_track_locked(NULL);
        return;
    }

    size_t idx = 0;
    if (s_current) {
        for (size_t i = 0; i < n; i++) {
            if (&all[i] == s_current) { idx = i; break; }
        }
    }

    if (s_st.shuffle && n > 1) {
        size_t next;
        do { next = (size_t)(esp_timer_get_time() % n); } while (next == idx);
        idx = next;
    } else {
        if (dir >= 0) {
            idx = (idx + 1) % n;
        } else {
            idx = (idx == 0) ? (n - 1) : (idx - 1);
        }
    }
    load_track_locked(&all[idx]);
    s_st.state = DPA_AUDIO_PLAYING;
}

/* ---------- SIM tick task ------------------------------------------- */

#if DPA_PLAYER_SIM_AUDIO
static void sim_tick_task(void *arg)
{
    (void)arg;
    const TickType_t period = pdMS_TO_TICKS(250);
    TickType_t last = xTaskGetTickCount();
    for (;;) {
        vTaskDelayUntil(&last, period);

        LOCK();
        if (s_st.state == DPA_AUDIO_PLAYING && s_st.duration_ms > 0) {
            s_st.position_ms += 250;
            if (s_st.position_ms >= s_st.duration_ms) {
                switch (s_st.repeat) {
                case DPA_REPEAT_ONE:
                    s_st.position_ms = 0;
                    break;
                case DPA_REPEAT_ALL:
                    advance_track_locked(+1);
                    break;
                case DPA_REPEAT_OFF:
                default: {
                    /* walk to next; if we loop back to the first track
                     * and repeat is OFF, stop. */
                    size_t n = 0;
                    const dpa_track_t *all = dpa_library_tracks(&n);
                    size_t idx = 0;
                    if (s_current && n > 0) {
                        for (size_t i = 0; i < n; i++) {
                            if (&all[i] == s_current) { idx = i; break; }
                        }
                    }
                    if (idx + 1 >= n) {
                        s_st.position_ms = s_st.duration_ms;
                        s_st.state       = DPA_AUDIO_STOPPED;
                    } else {
                        advance_track_locked(+1);
                    }
                    break;
                }
                }
            }
        }
        UNLOCK();
    }
}
#endif /* DPA_PLAYER_SIM_AUDIO */

/* ---------- public API ---------------------------------------------- */

esp_err_t dpa_audio_start(void)
{
    if (s_lock) return ESP_OK;
    s_lock = xSemaphoreCreateMutex();
    if (!s_lock) return ESP_ERR_NO_MEM;

#if DPA_PLAYER_SIM_AUDIO
    ESP_LOGW(TAG, "audio SIM mode — transport only, no I2S");
    xTaskCreate(sim_tick_task, "dpa_sim_audio", 3072, NULL, 4, NULL);
#else
    ESP_LOGI(TAG, "audio subsystem ready (Phase 4 decoder pending)");
#endif
    return ESP_OK;
}

esp_err_t dpa_audio_play(uint32_t track_id)
{
    LOCK();
    if (track_id != 0) {
        const dpa_track_t *t = dpa_library_find_by_id(track_id);
        if (!t) { UNLOCK(); return ESP_ERR_NOT_FOUND; }
        load_track_locked(t);
    } else if (!s_current) {
        load_track_locked(find_first_track());
    }
    if (s_current) s_st.state = DPA_AUDIO_PLAYING;
    UNLOCK();
    return s_current ? ESP_OK : ESP_ERR_NOT_FOUND;
}

esp_err_t dpa_audio_pause(void)
{
    LOCK();
    if (s_st.state == DPA_AUDIO_PLAYING) s_st.state = DPA_AUDIO_PAUSED;
    else if (s_st.state == DPA_AUDIO_PAUSED) s_st.state = DPA_AUDIO_PLAYING;
    UNLOCK();
    return ESP_OK;
}

esp_err_t dpa_audio_stop(void)
{
    LOCK();
    s_st.state       = DPA_AUDIO_STOPPED;
    s_st.position_ms = 0;
    UNLOCK();
    return ESP_OK;
}

esp_err_t dpa_audio_next(void)
{
    LOCK();
    advance_track_locked(+1);
    UNLOCK();
    return ESP_OK;
}

esp_err_t dpa_audio_prev(void)
{
    LOCK();
    /* If we're > 3s into the current track, seek to start instead
     * of jumping back. Matches every tabletop player since 1998. */
    if (s_st.position_ms > 3000) {
        s_st.position_ms = 0;
    } else {
        advance_track_locked(-1);
    }
    UNLOCK();
    return ESP_OK;
}

esp_err_t dpa_audio_seek(uint32_t ms)
{
    LOCK();
    if (ms > s_st.duration_ms) ms = s_st.duration_ms;
    s_st.position_ms = ms;
    UNLOCK();
    return ESP_OK;
}

esp_err_t dpa_audio_set_volume(uint8_t v)
{
    if (v > 100) v = 100;
    LOCK();
    s_st.volume = v;
    UNLOCK();
    return ESP_OK;
}

esp_err_t dpa_audio_set_shuffle(bool on)
{
    LOCK();
    s_st.shuffle = on;
    UNLOCK();
    return ESP_OK;
}

esp_err_t dpa_audio_set_repeat(dpa_repeat_mode_t m)
{
    LOCK();
    s_st.repeat = m;
    UNLOCK();
    return ESP_OK;
}

void dpa_audio_get_status(dpa_audio_status_t *out)
{
    if (!out) return;
    if (!s_lock) {
        memset(out, 0, sizeof(*out));
        out->simulated = (bool)DPA_PLAYER_SIM_AUDIO;
        return;
    }
    LOCK();
    *out = s_st;
    UNLOCK();
}

const dpa_track_t *dpa_audio_current_track(void)
{
    return s_current;
}
