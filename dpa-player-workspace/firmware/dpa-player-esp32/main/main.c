/*
 * DPA Player — firmware entry point
 * ---------------------------------
 * Pure ESP-IDF 5.x. Phase 1 brings up the SoftAP on 192.168.5.1, the
 * captive DNS hijack, and the HTTP server. Later phases will attach
 * SD mount, audio pipeline, LED driver, and the real JSON API on
 * top of the HTTP instance started here.
 */

#include <stdio.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_chip_info.h"
#include "nvs_flash.h"

#include "config.h"
#include "wifi_ap.h"
#include "captive_dns.h"
#include "http_srv.h"
#include "sd_card.h"

static const char *TAG = "dpa-player";

static void init_nvs(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES ||
        err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);
}

static void log_banner(void)
{
    esp_chip_info_t chip;
    esp_chip_info(&chip);
    ESP_LOGI(TAG, "================================");
    ESP_LOGI(TAG, "  DPA Player  -  Phase 1 online ");
    ESP_LOGI(TAG, "================================");
    ESP_LOGI(TAG, "Chip:      %s (rev %d)", CONFIG_IDF_TARGET, chip.revision);
    ESP_LOGI(TAG, "Cores:     %d", chip.cores);
    ESP_LOGI(TAG, "IDF:       %s", esp_get_idf_version());
    ESP_LOGI(TAG, "Free heap: %lu bytes",
             (unsigned long)esp_get_free_heap_size());
}

void app_main(void)
{
    init_nvs();
    log_banner();

    /* Phase 1 subsystems -------------------------------------- */
    ESP_ERROR_CHECK(dpa_wifi_ap_start());
    ESP_ERROR_CHECK(dpa_captive_dns_start());
    ESP_ERROR_CHECK(dpa_http_srv_start());

    /* Phase 2a — SD card. NON-fatal: device can boot + run the AP
     * even with no card wired so dev can iterate on the UI before
     * the storage adapter is soldered in. */
    esp_err_t sd_err = dpa_sd_init();
    if (sd_err != ESP_OK) {
        ESP_LOGW(TAG, "SD init failed (%s) — continuing without storage",
                 esp_err_to_name(sd_err));
    } else {
        /* Make sure the library root + unsorted drop folder exist
         * so Phase 3 uploads have a place to land. */
        dpa_sd_mkdir_p(DPA_PLAYER_LIBRARY_ROOT);
        dpa_sd_mkdir_p(DPA_PLAYER_UNSORTED_DIR);
    }

    ESP_LOGI(TAG, "SSID:      %s",  dpa_wifi_ap_ssid());
    ESP_LOGI(TAG, "AP IP:     %s",  DPA_PLAYER_AP_IP);
    ESP_LOGI(TAG, "HTTP:      http://%s/",           DPA_PLAYER_AP_IP);
    ESP_LOGI(TAG, "Status:    http://%s/api/status", DPA_PLAYER_AP_IP);
    ESP_LOGI(TAG, "SD:        %s", dpa_sd_is_mounted() ? "mounted" : "not present");

    /* Idle. Watchdog-friendly heartbeat so devs can tell the
     * board is alive over USB CDC even before Phase 2 audio. */
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(30000));
        ESP_LOGI(TAG, "alive | heap=%lu clients=%d",
                 (unsigned long)esp_get_free_heap_size(),
                 dpa_wifi_ap_station_count());
    }
}
