/*
 * DPA Player — Phase 0 boot stub
 * ------------------------------------------------------------
 * Pure ESP-IDF 5.x application. Will be progressively filled in as
 * subsystems are ported from arduino-src/ (Arduino reference tree
 * cloned from DPA Album commit 2aedf75).
 *
 * Current behaviour: init NVS, print boot banner, idle forever.
 */

#include <stdio.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_chip_info.h"
#include "nvs_flash.h"

static const char *TAG = "dpa-player";

void app_main(void)
{
    /* NVS — required by WiFi + Preferences later */
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);

    esp_chip_info_t chip;
    esp_chip_info(&chip);

    ESP_LOGI(TAG, "================================");
    ESP_LOGI(TAG, "  DPA Player — Phase 0 scaffold ");
    ESP_LOGI(TAG, "================================");
    ESP_LOGI(TAG, "Chip:    %s (rev %d)", CONFIG_IDF_TARGET, chip.revision);
    ESP_LOGI(TAG, "Cores:   %d", chip.cores);
    ESP_LOGI(TAG, "IDF ver: %s", esp_get_idf_version());
    ESP_LOGI(TAG, "Free heap: %lu bytes", (unsigned long)esp_get_free_heap_size());
    ESP_LOGI(TAG, "Phase 1 (wifi) not yet wired — holding boot.");

    /* Idle. Subsequent phases will start WiFi AP, HTTP server,
     * SD mount, audio pipeline, LED driver, etc. */
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(10000));
        ESP_LOGI(TAG, "idle, free heap=%lu", (unsigned long)esp_get_free_heap_size());
    }
}
