/*
 * DPA Player — SD card manager (pure ESP-IDF)
 * --------------------------------------------
 * Wraps esp_vfs_fat_sdspi_mount so the rest of the firmware can
 * use POSIX I/O (fopen/fwrite/opendir/etc.) against "/sd/...".
 *
 * Graceful no-hardware degradation: if dpa_sd_init() fails because
 * no card is wired, every accessor returns zeros / false and the
 * rest of the firmware keeps running. This lets dev boot the board
 * in AP-only mode before the SD adapter is soldered.
 */

#include "sd_card.h"
#include "config.h"

#include <string.h>
#include <sys/stat.h>
#include <errno.h>

#include "esp_log.h"
#include "esp_vfs_fat.h"
#include "sdmmc_cmd.h"
#include "driver/sdspi_host.h"
#include "driver/spi_common.h"

static const char *TAG = "sd_card";

static bool               s_mounted       = false;
static sdmmc_card_t      *s_card          = NULL;
static sdspi_dev_handle_t s_sdspi         = -1;
static sdmmc_host_t       s_host          = SDSPI_HOST_DEFAULT();
static uint32_t           s_current_khz   = 0;
static bool               s_bus_initted   = false;

bool dpa_sd_is_mounted(void) { return s_mounted; }

esp_err_t dpa_sd_init(void)
{
    if (s_mounted) return ESP_OK;

    ESP_LOGI(TAG, "probing SD card on SPI (CS=%d MOSI=%d SCK=%d MISO=%d)",
             DPA_PLAYER_SD_PIN_CS, DPA_PLAYER_SD_PIN_MOSI,
             DPA_PLAYER_SD_PIN_SCK, DPA_PLAYER_SD_PIN_MISO);

    s_host = (sdmmc_host_t)SDSPI_HOST_DEFAULT();
    s_host.max_freq_khz = DPA_PLAYER_SD_FREQ_SLOW_KHZ;

    spi_bus_config_t bus_cfg = {
        .mosi_io_num     = DPA_PLAYER_SD_PIN_MOSI,
        .miso_io_num     = DPA_PLAYER_SD_PIN_MISO,
        .sclk_io_num     = DPA_PLAYER_SD_PIN_SCK,
        .quadwp_io_num   = -1,
        .quadhd_io_num   = -1,
        .max_transfer_sz = 4096,
    };

    esp_err_t err = spi_bus_initialize(s_host.slot, &bus_cfg, SDSPI_DEFAULT_DMA);
    if (err == ESP_ERR_INVALID_STATE) {
        /* Bus already initialized by someone else (e.g. hot reinit). OK. */
        ESP_LOGW(TAG, "SPI bus already initialized, reusing");
    } else if (err != ESP_OK) {
        ESP_LOGE(TAG, "spi_bus_initialize failed: %s", esp_err_to_name(err));
        return err;
    } else {
        s_bus_initted = true;
    }

    sdspi_device_config_t slot_cfg = SDSPI_DEVICE_CONFIG_DEFAULT();
    slot_cfg.gpio_cs = DPA_PLAYER_SD_PIN_CS;
    slot_cfg.host_id = s_host.slot;

    esp_vfs_fat_sdmmc_mount_config_t mount_cfg = {
        .format_if_mount_failed = false,
        .max_files              = 5,
        .allocation_unit_size   = 16 * 1024,
    };

    err = esp_vfs_fat_sdspi_mount(DPA_PLAYER_SD_MOUNT, &s_host,
                                  &slot_cfg, &mount_cfg, &s_card);
    if (err != ESP_OK) {
        if (err == ESP_FAIL) {
            ESP_LOGW(TAG, "FAT mount failed — card present but unformatted?");
        } else {
            ESP_LOGW(TAG, "mount failed: %s (no card, wiring, or bad contact)",
                     esp_err_to_name(err));
        }
        /* Release the SPI bus if we took it so a future retry can
         * re-initialize cleanly. */
        if (s_bus_initted) {
            spi_bus_free(s_host.slot);
            s_bus_initted = false;
        }
        return err;
    }

    s_mounted     = true;
    s_current_khz = DPA_PLAYER_SD_FREQ_SLOW_KHZ;

    sdmmc_card_print_info(stdout, s_card);

    /* Bump to fast clock for audio once the card is known-good. */
    dpa_sd_set_speed(DPA_PLAYER_SD_FREQ_FAST_KHZ);

    ESP_LOGI(TAG, "SD mounted at %s", DPA_PLAYER_SD_MOUNT);
    return ESP_OK;
}

void dpa_sd_deinit(void)
{
    if (s_mounted) {
        esp_vfs_fat_sdcard_unmount(DPA_PLAYER_SD_MOUNT, s_card);
        s_mounted = false;
        s_card = NULL;
    }
    if (s_bus_initted) {
        spi_bus_free(s_host.slot);
        s_bus_initted = false;
    }
    s_current_khz = 0;
}

esp_err_t dpa_sd_set_speed(uint32_t khz)
{
    if (!s_mounted) return ESP_ERR_INVALID_STATE;
    if (khz == s_current_khz) return ESP_OK;

    esp_err_t err = sdmmc_host_set_card_clk(s_host.slot, khz);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "set_card_clk(%u) failed: %s",
                 (unsigned)khz, esp_err_to_name(err));
        return err;
    }
    s_current_khz = khz;
    ESP_LOGI(TAG, "SD clock -> %u kHz", (unsigned)khz);
    return ESP_OK;
}

void dpa_sd_get_info(dpa_sd_info_t *out)
{
    if (!out) return;
    memset(out, 0, sizeof(*out));

    if (!s_mounted || !s_card) return;

    out->mounted    = true;
    out->speed_khz  = s_current_khz;

    if (s_card->cid.name[0]) {
        strncpy(out->card_name, s_card->cid.name,
                sizeof(out->card_name) - 1);
    } else {
        strncpy(out->card_name, "SD", sizeof(out->card_name) - 1);
    }

    /* Pull FAT usage via the VFS helper. */
    uint64_t total = 0, free_b = 0;
    esp_err_t err = esp_vfs_fat_info(DPA_PLAYER_SD_MOUNT, &total, &free_b);
    if (err == ESP_OK) {
        out->total_bytes = total;
        out->free_bytes  = free_b;
        out->used_bytes  = (total > free_b) ? (total - free_b) : 0;
    }
}

char *dpa_sd_path(char *out, size_t out_len, const char *rel)
{
    if (!out || out_len == 0) return NULL;
    if (!rel) rel = "";
    if (rel[0] == '/') {
        snprintf(out, out_len, "%s%s", DPA_PLAYER_SD_MOUNT, rel);
    } else {
        snprintf(out, out_len, "%s/%s", DPA_PLAYER_SD_MOUNT, rel);
    }
    return out;
}

esp_err_t dpa_sd_mkdir_p(const char *rel)
{
    if (!s_mounted) return ESP_ERR_INVALID_STATE;
    if (!rel || !rel[0]) return ESP_ERR_INVALID_ARG;

    char abs[192];
    dpa_sd_path(abs, sizeof(abs), rel);

    /* Walk path creating each intermediate directory. */
    size_t len = strlen(abs);
    for (size_t i = 1; i <= len; i++) {
        if (abs[i] == '/' || abs[i] == '\0') {
            char save = abs[i];
            abs[i] = '\0';
            if (mkdir(abs, 0777) != 0 && errno != EEXIST) {
                ESP_LOGW(TAG, "mkdir(%s) errno=%d", abs, errno);
                /* keep going — it might be a FAT root entry */
            }
            abs[i] = save;
        }
    }
    return ESP_OK;
}
