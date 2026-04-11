/*
 * DPA Player — HTTP server (pure ESP-IDF)
 * ----------------------------------------
 * Captive portal landing + OS probe handlers. No Arduino
 * ESPAsyncWebServer. All handlers live on a single esp_http_server
 * instance bound to port 80 on the AP netif.
 */

#include "http_srv.h"
#include "config.h"
#include "wifi_ap.h"
#include "sd_card.h"

#include <string.h>

#include "esp_log.h"
#include "esp_http_server.h"

static const char *TAG = "http_srv";

static httpd_handle_t s_server = NULL;

static const char *LANDING_HTML =
    "<!doctype html><html><head><meta charset=\"utf-8\">"
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
    "<title>DPA Player</title>"
    "<style>"
    "body{margin:0;background:#0b0b0f;color:#e8e8ee;"
    "font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;"
    "display:flex;align-items:center;justify-content:center;"
    "min-height:100vh;padding:24px;text-align:center}"
    "h1{font-size:28px;margin:0 0 8px;letter-spacing:.5px}"
    "p{margin:6px 0;color:#b4b4c0;font-size:14px}"
    ".b{display:inline-block;padding:12px 24px;border-radius:999px;"
    "background:#7b5cff;color:#fff;text-decoration:none;margin-top:16px}"
    "</style></head><body><div>"
    "<h1>DPA Player</h1>"
    "<p>Connected to your portable hi-res player.</p>"
    "<p style=\"font-size:12px;color:#6c6c7c\">Phase 1 online"
    " &middot; 192.168.5.1</p>"
    "<a class=\"b\" href=\"/\">Open portal</a>"
    "</div></body></html>";

/* ------- handlers ----------------------------------------------- */

static esp_err_t root_get(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_send(req, LANDING_HTML, HTTPD_RESP_USE_STRLEN);
}

/* Android captive portal probe — returning 204 means "already
 * online", returning 200 triggers the OS sign-in banner. We return
 * 200 with landing HTML so Android pops the captive portal UI. */
static esp_err_t android_probe_get(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    return httpd_resp_send(req, LANDING_HTML, HTTPD_RESP_USE_STRLEN);
}

/* Apple captive portal probe — macOS/iOS expect literal
 * "Success" HTML when online; anything else triggers captive UI. */
static esp_err_t apple_probe_get(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    return httpd_resp_send(req, LANDING_HTML, HTTPD_RESP_USE_STRLEN);
}

/* Catch-all 404 that redirects to / so any typed URL resolves to
 * the landing page once the phone is on the Player's SSID. */
static esp_err_t not_found(httpd_req_t *req, httpd_err_code_t err)
{
    (void)err;
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", "http://" DPA_PLAYER_AP_IP "/");
    httpd_resp_send(req, NULL, 0);
    return ESP_OK;
}

/* GET /api/status — liveness + storage snapshot. Everything nullable
 * reports neutral values when absent so the Angular portal doesn't
 * need to special-case boot state. */
static esp_err_t status_get(httpd_req_t *req)
{
    dpa_sd_info_t sd = {0};
    dpa_sd_get_info(&sd);

    char body[384];
    int n = snprintf(body, sizeof(body),
        "{\"product\":\"dpa-player\",\"phase\":2,"
        "\"ssid\":\"%s\",\"ip\":\"%s\",\"clients\":%d,"
        "\"sd\":{\"mounted\":%s,\"total\":%llu,\"used\":%llu,\"free\":%llu,"
              "\"speedKhz\":%u,\"name\":\"%s\"}}",
        dpa_wifi_ap_ssid(), DPA_PLAYER_AP_IP, dpa_wifi_ap_station_count(),
        sd.mounted ? "true" : "false",
        (unsigned long long)sd.total_bytes,
        (unsigned long long)sd.used_bytes,
        (unsigned long long)sd.free_bytes,
        (unsigned)sd.speed_khz,
        sd.card_name[0] ? sd.card_name : "");
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_send(req, body, n);
}

/* ------- wiring -------------------------------------------------- */

static const httpd_uri_t uri_root = {
    .uri = "/",  .method = HTTP_GET, .handler = root_get,
};
static const httpd_uri_t uri_android = {
    .uri = "/generate_204", .method = HTTP_GET, .handler = android_probe_get,
};
static const httpd_uri_t uri_android2 = {
    .uri = "/gen_204", .method = HTTP_GET, .handler = android_probe_get,
};
static const httpd_uri_t uri_apple = {
    .uri = "/hotspot-detect.html", .method = HTTP_GET, .handler = apple_probe_get,
};
static const httpd_uri_t uri_apple2 = {
    .uri = "/library/test/success.html", .method = HTTP_GET, .handler = apple_probe_get,
};
static const httpd_uri_t uri_status = {
    .uri = "/api/status", .method = HTTP_GET, .handler = status_get,
};

esp_err_t dpa_http_srv_start(void)
{
    if (s_server) {
        return ESP_OK;
    }
    httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
    cfg.server_port    = DPA_PLAYER_HTTP_PORT;
    cfg.max_uri_handlers = 16;
    cfg.lru_purge_enable = true;
    cfg.uri_match_fn    = httpd_uri_match_wildcard;

    esp_err_t err = httpd_start(&s_server, &cfg);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "httpd_start failed: %s", esp_err_to_name(err));
        s_server = NULL;
        return err;
    }

    httpd_register_uri_handler(s_server, &uri_root);
    httpd_register_uri_handler(s_server, &uri_android);
    httpd_register_uri_handler(s_server, &uri_android2);
    httpd_register_uri_handler(s_server, &uri_apple);
    httpd_register_uri_handler(s_server, &uri_apple2);
    httpd_register_uri_handler(s_server, &uri_status);

    httpd_register_err_handler(s_server, HTTPD_404_NOT_FOUND, not_found);

    ESP_LOGI(TAG, "HTTP server ready on port %d", DPA_PLAYER_HTTP_PORT);
    return ESP_OK;
}

httpd_handle_t dpa_http_srv_handle(void)
{
    return s_server;
}
