/*
 * DPA Player — WiFi SoftAP
 * Pure ESP-IDF. No Arduino WiFi.h.
 */

#ifndef DPA_PLAYER_WIFI_AP_H
#define DPA_PLAYER_WIFI_AP_H

#include "esp_err.h"
#include "esp_netif.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Starts the SoftAP on 192.168.5.1 with SSID "DPA-Player-XXXX".
 * NVS flash MUST already be initialized by the caller. */
esp_err_t dpa_wifi_ap_start(void);

/* Returns the esp_netif for the AP so other modules (DNS, HTTP)
 * can bind to it. NULL until dpa_wifi_ap_start() has succeeded. */
esp_netif_t *dpa_wifi_ap_netif(void);

/* Returns the generated SSID (e.g. "DPA-Player-3F7A") after start. */
const char *dpa_wifi_ap_ssid(void);

/* Number of currently associated stations. */
int dpa_wifi_ap_station_count(void);

#ifdef __cplusplus
}
#endif

#endif /* DPA_PLAYER_WIFI_AP_H */
