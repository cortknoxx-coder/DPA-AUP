/*
 * DPA Player — front-panel LED driver
 * Owns the single WS2812 indicator LED on the ESP32-S3 Zero.
 * In SIM mode we only maintain an in-memory RGB value and log
 * mode transitions — no RMT traffic — so the firmware runs on
 * any board regardless of whether the strip is wired up.
 *
 * Phase 5 will add the real led_strip + RMT backend behind the
 * same dpa_led_set_mode() API.
 */

#ifndef DPA_PLAYER_LED_H
#define DPA_PLAYER_LED_H

#include <stdint.h>
#include <stdbool.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    DPA_LED_MODE_OFF = 0,
    DPA_LED_MODE_BOOT,     /* solid violet during boot */
    DPA_LED_MODE_READY,    /* dim violet, AP up */
    DPA_LED_MODE_PLAYING,  /* purple breathe while audio plays */
    DPA_LED_MODE_PAUSED,   /* amber breathe while paused */
    DPA_LED_MODE_ERROR,    /* red slow blink */
} dpa_led_mode_t;

typedef struct {
    dpa_led_mode_t mode;
    uint8_t        r, g, b;   /* current on-wire value (post-dim) */
    uint8_t        brightness;/* 0..255 user-facing max */
    bool           simulated;
} dpa_led_status_t;

esp_err_t dpa_led_start(void);

esp_err_t dpa_led_set_mode(dpa_led_mode_t mode);
esp_err_t dpa_led_set_brightness(uint8_t value);

void      dpa_led_get_status(dpa_led_status_t *out);
const char *dpa_led_mode_name(dpa_led_mode_t m);

#ifdef __cplusplus
}
#endif

#endif /* DPA_PLAYER_LED_H */
