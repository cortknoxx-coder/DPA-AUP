/*
 * DPA Player — LED indicator (simulation-first)
 * -----------------------------------------------
 * Tracks mode + color + brightness in RAM. In SIM mode we log a
 * one-line summary on every mode change so the serial console can
 * serve as a stand-in for the physical LED until Phase 5 wires up
 * the led_strip RMT backend.
 */

#include "led.h"
#include "config.h"

#include <string.h>

#include "esp_log.h"

static const char *TAG = "led";

static dpa_led_status_t s_st = {
    .mode       = DPA_LED_MODE_OFF,
    .brightness = 160,
    .simulated  = (bool)DPA_PLAYER_SIM_LED,
};

/* Canonical palette per mode. Kept in one table so both SIM logs
 * and the real Phase-5 driver render the same colors. */
typedef struct {
    uint8_t r, g, b;
} rgb_t;

static const rgb_t MODE_RGB[] = {
    [DPA_LED_MODE_OFF]     = {   0,   0,   0 },
    [DPA_LED_MODE_BOOT]    = { 123,  92, 255 },
    [DPA_LED_MODE_READY]   = {  48,  36, 120 },
    [DPA_LED_MODE_PLAYING] = { 180,  80, 255 },
    [DPA_LED_MODE_PAUSED]  = { 255, 140,  40 },
    [DPA_LED_MODE_ERROR]   = { 255,  40,  40 },
};

static void apply_locked(void)
{
    rgb_t base = MODE_RGB[s_st.mode];
    /* Scale into brightness budget. */
    s_st.r = (uint8_t)((uint16_t)base.r * s_st.brightness / 255);
    s_st.g = (uint8_t)((uint16_t)base.g * s_st.brightness / 255);
    s_st.b = (uint8_t)((uint16_t)base.b * s_st.brightness / 255);

#if DPA_PLAYER_SIM_LED
    ESP_LOGI(TAG, "SIM led=%s rgb=(%u,%u,%u) bright=%u",
             dpa_led_mode_name(s_st.mode),
             s_st.r, s_st.g, s_st.b, s_st.brightness);
#else
    /* Phase 5: push to led_strip here. */
#endif
}

esp_err_t dpa_led_start(void)
{
#if DPA_PLAYER_SIM_LED
    ESP_LOGW(TAG, "LED SIM mode — no RMT driver");
#endif
    dpa_led_set_mode(DPA_LED_MODE_BOOT);
    return ESP_OK;
}

esp_err_t dpa_led_set_mode(dpa_led_mode_t mode)
{
    if (mode < DPA_LED_MODE_OFF || mode > DPA_LED_MODE_ERROR) {
        return ESP_ERR_INVALID_ARG;
    }
    s_st.mode = mode;
    apply_locked();
    return ESP_OK;
}

esp_err_t dpa_led_set_brightness(uint8_t value)
{
    s_st.brightness = value;
    apply_locked();
    return ESP_OK;
}

void dpa_led_get_status(dpa_led_status_t *out)
{
    if (!out) return;
    *out = s_st;
}

const char *dpa_led_mode_name(dpa_led_mode_t m)
{
    switch (m) {
    case DPA_LED_MODE_OFF:     return "off";
    case DPA_LED_MODE_BOOT:    return "boot";
    case DPA_LED_MODE_READY:   return "ready";
    case DPA_LED_MODE_PLAYING: return "playing";
    case DPA_LED_MODE_PAUSED:  return "paused";
    case DPA_LED_MODE_ERROR:   return "error";
    default:                   return "unknown";
    }
}
