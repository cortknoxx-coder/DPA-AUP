/*
 * DPA Player — SD card manager
 * Pure ESP-IDF esp_vfs_fat_sdspi_mount wrapper with graceful
 * no-card degradation so dev can run the firmware without hardware.
 */

#ifndef DPA_PLAYER_SD_CARD_H
#define DPA_PLAYER_SD_CARD_H

#include <stdint.h>
#include <stdbool.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    bool     mounted;          /* false until dpa_sd_init() succeeds */
    uint64_t total_bytes;      /* FAT total bytes */
    uint64_t used_bytes;       /* total - free */
    uint64_t free_bytes;
    uint32_t speed_khz;        /* current SPI clock */
    char     card_name[32];    /* e.g. "SDHC" */
} dpa_sd_info_t;

/* Initializes SPI bus + mounts FAT at /sd. Returns ESP_OK on success,
 * ESP_ERR_NOT_FOUND if no card present, or a host-specific error for
 * wiring problems. Non-fatal: caller should LOG and continue even on
 * failure — all SD-dependent modules (library, upload, playback)
 * must themselves check dpa_sd_is_mounted() before touching paths. */
esp_err_t dpa_sd_init(void);

/* Cleanly unmounts + frees the SPI bus. Idempotent. */
void dpa_sd_deinit(void);

bool dpa_sd_is_mounted(void);

/* Populates *out with the latest info. Always safe to call;
 * returns zeros when the card is not mounted. */
void dpa_sd_get_info(dpa_sd_info_t *out);

/* Switches the card's SPI clock on the fly. Use the SLOW speed
 * before multi-MB writes (upload), the FAST speed for audio read.
 * No-op if not mounted. */
esp_err_t dpa_sd_set_speed(uint32_t khz);

/* Builds an absolute "/sd/..." path from a relative track path.
 * Writes into `out` up to out_len. Returns out on success. */
char *dpa_sd_path(char *out, size_t out_len, const char *rel);

/* Ensures a directory exists under /sd (creates intermediate dirs
 * up to one level). Non-fatal if not mounted. */
esp_err_t dpa_sd_mkdir_p(const char *rel);

#ifdef __cplusplus
}
#endif

#endif /* DPA_PLAYER_SD_CARD_H */
