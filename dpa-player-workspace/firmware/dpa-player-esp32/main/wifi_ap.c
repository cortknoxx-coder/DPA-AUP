/*
 * DPA Player — WiFi SoftAP (pure ESP-IDF)
 * ----------------------------------------
 * Brings up an open 2.4 GHz SoftAP on 192.168.5.1/24 with SSID
 * "DPA-Player-XXXX" derived from the last 2 bytes of the MAC.
 *
 * Replaces the Arduino WiFi.h / WiFi.softAP() pattern from the DPA
 * Album reference tree (arduino-src/dpa_wifi.h).
 */

#include "wifi_ap.h"
#include "config.h"

#include <string.h>
#include <stdio.h>

#include "esp_log.h"
#include "esp_mac.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_netif_ip_addr.h"

static const char *TAG = "wifi_ap";

static esp_netif_t *s_ap_netif = NULL;
static char s_ssid[33] = {0};   /* 32 chars max per 802.11 + NUL */
static volatile int s_station_count = 0;

static void wifi_event_cb(void *arg, esp_event_base_t base,
                          int32_t id, void *data)
{
    if (base != WIFI_EVENT) {
        return;
    }
    switch (id) {
    case WIFI_EVENT_AP_STACONNECTED: {
        wifi_event_ap_staconnected_t *e = (wifi_event_ap_staconnected_t *)data;
        s_station_count++;
        ESP_LOGI(TAG, "STA connected: " MACSTR " aid=%d (count=%d)",
                 MAC2STR(e->mac), e->aid, s_station_count);
        break;
    }
    case WIFI_EVENT_AP_STADISCONNECTED: {
        wifi_event_ap_stadisconnected_t *e = (wifi_event_ap_stadisconnected_t *)data;
        if (s_station_count > 0) {
            s_station_count--;
        }
        ESP_LOGI(TAG, "STA disconnected: " MACSTR " aid=%d (count=%d)",
                 MAC2STR(e->mac), e->aid, s_station_count);
        break;
    }
    case WIFI_EVENT_AP_START:
        ESP_LOGI(TAG, "AP started");
        break;
    case WIFI_EVENT_AP_STOP:
        ESP_LOGI(TAG, "AP stopped");
        break;
    default:
        break;
    }
}

static void build_ssid(char *out, size_t out_len)
{
    uint8_t mac[6] = {0};
    esp_read_mac(mac, ESP_MAC_WIFI_SOFTAP);
    /* Last 2 bytes of MAC → 4 hex chars, uppercase. */
    snprintf(out, out_len, "%s%02X%02X",
             DPA_PLAYER_SSID_PREFIX, mac[4], mac[5]);
}

static esp_err_t set_static_ip(esp_netif_t *netif)
{
    esp_netif_ip_info_t ip_info = {0};
    ip_info.ip.addr      = esp_ip4addr_aton(DPA_PLAYER_AP_IP);
    ip_info.gw.addr      = esp_ip4addr_aton(DPA_PLAYER_AP_GW);
    ip_info.netmask.addr = esp_ip4addr_aton(DPA_PLAYER_AP_NETMASK);

    /* DHCP server must be stopped before changing the AP IP. */
    esp_err_t err = esp_netif_dhcps_stop(netif);
    if (err != ESP_OK && err != ESP_ERR_ESP_NETIF_DHCP_ALREADY_STOPPED) {
        ESP_LOGE(TAG, "dhcps_stop failed: %s", esp_err_to_name(err));
        return err;
    }

    err = esp_netif_set_ip_info(netif, &ip_info);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "set_ip_info failed: %s", esp_err_to_name(err));
        return err;
    }

    err = esp_netif_dhcps_start(netif);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "dhcps_start failed: %s", esp_err_to_name(err));
        return err;
    }

    ESP_LOGI(TAG, "AP IP set to %s", DPA_PLAYER_AP_IP);
    return ESP_OK;
}

esp_err_t dpa_wifi_ap_start(void)
{
    esp_err_t err;

    /* TCP/IP + default event loop. Safe to call if someone already did. */
    ESP_ERROR_CHECK(esp_netif_init());
    err = esp_event_loop_create_default();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        return err;
    }

    /* Default AP netif (handles DHCP server). */
    s_ap_netif = esp_netif_create_default_wifi_ap();
    if (!s_ap_netif) {
        ESP_LOGE(TAG, "create_default_wifi_ap returned NULL");
        return ESP_FAIL;
    }

    ESP_ERROR_CHECK(set_static_ip(s_ap_netif));

    wifi_init_config_t wifi_cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&wifi_cfg));

    ESP_ERROR_CHECK(esp_event_handler_register(
        WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_cb, NULL));

    build_ssid(s_ssid, sizeof(s_ssid));

    wifi_config_t ap_cfg = {0};
    size_t ssid_len = strlen(s_ssid);
    memcpy(ap_cfg.ap.ssid, s_ssid, ssid_len);
    ap_cfg.ap.ssid_len       = ssid_len;
    ap_cfg.ap.channel        = DPA_PLAYER_AP_CHANNEL;
    ap_cfg.ap.max_connection = DPA_PLAYER_AP_MAX_CLIENTS;
    ap_cfg.ap.beacon_interval = 100;

#if DPA_PLAYER_AP_OPEN
    ap_cfg.ap.authmode = WIFI_AUTH_OPEN;
#else
    ap_cfg.ap.authmode = WIFI_AUTH_WPA2_PSK;
    strncpy((char *)ap_cfg.ap.password, DPA_PLAYER_AP_PASSWORD,
            sizeof(ap_cfg.ap.password) - 1);
#endif

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap_cfg));

    /* Disable power save — Album fleet found clients drop if enabled. */
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));

    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "SoftAP ready: SSID=\"%s\" ip=%s open=%d",
             s_ssid, DPA_PLAYER_AP_IP, DPA_PLAYER_AP_OPEN);
    return ESP_OK;
}

esp_netif_t *dpa_wifi_ap_netif(void)
{
    return s_ap_netif;
}

const char *dpa_wifi_ap_ssid(void)
{
    return s_ssid;
}

int dpa_wifi_ap_station_count(void)
{
    return s_station_count;
}
