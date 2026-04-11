/*
 * DPA Player — library scanner (pure ESP-IDF)
 * ---------------------------------------------
 * Walks /sd/tracks with POSIX opendir/readdir when an actual SD
 * card is present, up to DPA_PLAYER_LIBRARY_MAX_DEPTH directories
 * deep. For .dpa files we trust the on-disk DPA1 header to report
 * sample rate / channels / duration. For .flac/.wav files we leave
 * the metadata blank until the Phase 4 decoder can probe them.
 *
 * In simulation mode (or when the scanner finds nothing on a real
 * card), we seed a small canned catalog so the portal and player
 * state machine have something to render.
 */

#include "library.h"
#include "config.h"
#include "sd_card.h"
#include "dpa_format.h"

#include <string.h>
#include <stdlib.h>
#include <ctype.h>
#include <dirent.h>
#include <sys/stat.h>

#include "esp_log.h"

static const char *TAG = "library";

static dpa_track_t s_tracks[DPA_PLAYER_LIBRARY_MAX_TRACKS];
static size_t      s_count       = 0;
static uint32_t    s_next_id     = 1;

/* ---------- shared helpers ------------------------------------------ */

static dpa_track_t *next_slot(void)
{
    if (s_count >= DPA_PLAYER_LIBRARY_MAX_TRACKS) return NULL;
    dpa_track_t *t = &s_tracks[s_count++];
    memset(t, 0, sizeof(*t));
    t->id = s_next_id++;
    return t;
}

/* ---------- real SD scanner ----------------------------------------- */

#if !DPA_PLAYER_SIM_SD
static bool ends_with_ci(const char *s, const char *suffix)
{
    size_t ls = strlen(s), lx = strlen(suffix);
    if (lx > ls) return false;
    for (size_t i = 0; i < lx; i++) {
        if (tolower((unsigned char)s[ls - lx + i]) !=
            tolower((unsigned char)suffix[i])) return false;
    }
    return true;
}

static dpa_track_kind_t detect_kind(const char *name)
{
    if (ends_with_ci(name, ".dpa"))  return DPA_TRACK_KIND_DPA;
    if (ends_with_ci(name, ".flac")) return DPA_TRACK_KIND_FLAC;
    if (ends_with_ci(name, ".wav"))  return DPA_TRACK_KIND_WAV;
    return DPA_TRACK_KIND_UNKNOWN;
}

static void basename_without_ext(const char *path, char *out, size_t out_len)
{
    if (!path || !out || out_len == 0) return;
    const char *slash = strrchr(path, '/');
    const char *base  = slash ? slash + 1 : path;
    const char *dot   = strrchr(base, '.');
    size_t n = dot ? (size_t)(dot - base) : strlen(base);
    if (n >= out_len) n = out_len - 1;
    memcpy(out, base, n);
    out[n] = '\0';
}

static void scan_dir(const char *abs_path, int depth)
{
    if (depth > DPA_PLAYER_LIBRARY_MAX_DEPTH) return;
    DIR *d = opendir(abs_path);
    if (!d) {
        ESP_LOGD(TAG, "opendir(%s) failed", abs_path);
        return;
    }
    struct dirent *de;
    while ((de = readdir(d)) != NULL) {
        if (de->d_name[0] == '.') continue;   /* skip . .. .Trash */

        char child[192];
        snprintf(child, sizeof(child), "%s/%s", abs_path, de->d_name);

        struct stat st;
        if (stat(child, &st) != 0) continue;

        if (S_ISDIR(st.st_mode)) {
            scan_dir(child, depth + 1);
            continue;
        }

        dpa_track_kind_t kind = detect_kind(de->d_name);
        if (kind == DPA_TRACK_KIND_UNKNOWN) continue;

        dpa_track_t *t = next_slot();
        if (!t) { closedir(d); return; }

        strncpy(t->path, child, sizeof(t->path) - 1);
        t->kind         = kind;
        t->payload_size = (uint32_t)st.st_size;
        basename_without_ext(child, t->title, sizeof(t->title));

        if (kind == DPA_TRACK_KIND_DPA) {
            dpa_file_header_t h;
            if (dpa_format_probe_file(child, &h)) {
                if (h.title[0]) {
                    strncpy(t->title, h.title, sizeof(t->title) - 1);
                }
                t->duration_ms     = h.duration_ms;
                t->sample_rate     = h.sample_rate;
                t->channels        = h.channels;
                t->bits_per_sample = h.bits_per_sample;
                t->payload_size    = h.payload_size;
            }
        }
    }
    closedir(d);
}
#endif /* !DPA_PLAYER_SIM_SD */

/* ---------- canned simulation catalog ------------------------------- */

typedef struct {
    const char *title;
    const char *artist;
    const char *album;
    uint32_t    duration_ms;
    uint32_t    sample_rate;
    uint16_t    bits_per_sample;
    uint16_t    channels;
    dpa_track_kind_t kind;
} sim_seed_t;

static const sim_seed_t SIM_SEEDS[] = {
    { "Analogue Dawn",        "Aureus",        "First Light",   241000,  96000, 24, 2, DPA_TRACK_KIND_FLAC },
    { "Night Circuit",        "Loop Theory",   "Copper Skies",  316500,  96000, 24, 2, DPA_TRACK_KIND_FLAC },
    { "Ruby Weather",         "Paper Ocean",   "Copper Skies",  204000,  48000, 24, 2, DPA_TRACK_KIND_FLAC },
    { "Slow Drift (Live)",    "Paper Ocean",   "Open Field",    482000,  96000, 24, 2, DPA_TRACK_KIND_DPA  },
    { "Grains",               "Wavefold",      "Textures",      278000, 192000, 24, 2, DPA_TRACK_KIND_DPA  },
    { "Violet Hours",         "Aureus",        "First Light",   197500,  44100, 16, 2, DPA_TRACK_KIND_WAV  },
    { "Chorale for Morning",  "The Archives",  "Halls",         362000,  96000, 24, 2, DPA_TRACK_KIND_FLAC },
    { "Last Platform",        "Loop Theory",   "Copper Skies",  298000,  96000, 24, 2, DPA_TRACK_KIND_FLAC },
};
static const size_t SIM_SEED_COUNT = sizeof(SIM_SEEDS) / sizeof(SIM_SEEDS[0]);

static void seed_simulated_catalog(void)
{
    for (size_t i = 0; i < SIM_SEED_COUNT; i++) {
        dpa_track_t *t = next_slot();
        if (!t) return;
        const sim_seed_t *s = &SIM_SEEDS[i];

        snprintf(t->path, sizeof(t->path), "/sim/%02u-%s.%s",
                 (unsigned)(i + 1), s->title,
                 s->kind == DPA_TRACK_KIND_FLAC ? "flac" :
                 s->kind == DPA_TRACK_KIND_WAV  ? "wav"  : "dpa");
        strncpy(t->title,  s->title,  sizeof(t->title)  - 1);
        strncpy(t->artist, s->artist, sizeof(t->artist) - 1);
        strncpy(t->album,  s->album,  sizeof(t->album)  - 1);
        t->duration_ms     = s->duration_ms;
        t->sample_rate     = s->sample_rate;
        t->channels        = s->channels;
        t->bits_per_sample = s->bits_per_sample;
        t->kind            = s->kind;
        t->simulated       = true;

        /* Synthesize a plausible payload size from duration x bit-rate
         * so storage totals look honest in the UI. */
        uint64_t bytes_per_sec = (uint64_t)s->sample_rate *
                                  s->channels *
                                  (s->bits_per_sample / 8);
        t->payload_size = (uint32_t)(bytes_per_sec *
                                     s->duration_ms / 1000ULL);
    }
}

/* ---------- public API ---------------------------------------------- */

esp_err_t dpa_library_init(void)
{
    dpa_library_rescan();
    return ESP_OK;
}

int dpa_library_rescan(void)
{
    s_count   = 0;
    s_next_id = 1;

#if DPA_PLAYER_SIM_SD
    ESP_LOGI(TAG, "SIM mode — seeding canned catalog");
    seed_simulated_catalog();
#else
    if (!dpa_sd_is_mounted()) {
        ESP_LOGW(TAG, "SD not mounted — seeding sim catalog as fallback");
        seed_simulated_catalog();
    } else {
        char root[96];
        dpa_sd_path(root, sizeof(root), DPA_PLAYER_LIBRARY_ROOT);
        ESP_LOGI(TAG, "scanning %s (max depth=%d)",
                 root, DPA_PLAYER_LIBRARY_MAX_DEPTH);
        scan_dir(root, 0);
        if (s_count == 0) {
            ESP_LOGW(TAG, "no tracks on disk — seeding sim catalog");
            seed_simulated_catalog();
        }
    }
#endif

    ESP_LOGI(TAG, "library ready: %u tracks", (unsigned)s_count);
    return (int)s_count;
}

const dpa_track_t *dpa_library_tracks(size_t *out_count)
{
    if (out_count) *out_count = s_count;
    return s_tracks;
}

const dpa_track_t *dpa_library_get(size_t index)
{
    if (index == 0 || index > s_count) return NULL;
    return &s_tracks[index - 1];
}

const dpa_track_t *dpa_library_find_by_id(uint32_t id)
{
    for (size_t i = 0; i < s_count; i++) {
        if (s_tracks[i].id == id) return &s_tracks[i];
    }
    return NULL;
}

const char *dpa_library_kind_name(dpa_track_kind_t k)
{
    switch (k) {
    case DPA_TRACK_KIND_DPA:  return "DPA";
    case DPA_TRACK_KIND_FLAC: return "FLAC";
    case DPA_TRACK_KIND_WAV:  return "WAV";
    default:                  return "UNKNOWN";
    }
}
