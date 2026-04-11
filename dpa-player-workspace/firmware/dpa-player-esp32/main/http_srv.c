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
#include "library.h"
#include "audio.h"
#include "led.h"

#include <string.h>
#include <stdlib.h>

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

/* Common CORS headers so the Angular dev server on :8090 can hit
 * the real device during `ng serve`. */
static void cors(httpd_req_t *req)
{
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin",  "*");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "content-type");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Methods",
                       "GET,POST,PUT,DELETE,OPTIONS");
}

static const char *audio_state_name(dpa_audio_state_t s)
{
    switch (s) {
    case DPA_AUDIO_PLAYING: return "playing";
    case DPA_AUDIO_PAUSED:  return "paused";
    case DPA_AUDIO_STOPPED:
    default:                return "stopped";
    }
}

static const char *repeat_name(dpa_repeat_mode_t m)
{
    switch (m) {
    case DPA_REPEAT_ONE: return "one";
    case DPA_REPEAT_ALL: return "all";
    case DPA_REPEAT_OFF:
    default:             return "off";
    }
}

/* GET /api/status — liveness + storage + transport snapshot.
 * Everything nullable reports neutral values when absent so the
 * Angular portal doesn't need to special-case boot state. */
static esp_err_t status_get(httpd_req_t *req)
{
    dpa_sd_info_t      sd    = {0};
    dpa_audio_status_t audio = {0};
    dpa_led_status_t   led   = {0};
    dpa_sd_get_info(&sd);
    dpa_audio_get_status(&audio);
    dpa_led_get_status(&led);

    size_t lib_count = 0;
    dpa_library_tracks(&lib_count);

    char body[768];
    int n = snprintf(body, sizeof(body),
        "{\"product\":\"dpa-player\",\"phase\":2,"
        "\"sim\":%s,"
        "\"ssid\":\"%s\",\"ip\":\"%s\",\"clients\":%d,"
        "\"sd\":{\"mounted\":%s,\"simulated\":%s,\"total\":%llu,\"used\":%llu,"
              "\"free\":%llu,\"speedKhz\":%u,\"name\":\"%s\"},"
        "\"library\":{\"count\":%u},"
        "\"player\":{\"state\":\"%s\",\"trackId\":%u,\"positionMs\":%u,"
                   "\"durationMs\":%u,\"volume\":%u,\"shuffle\":%s,"
                   "\"repeat\":\"%s\",\"simulated\":%s},"
        "\"led\":{\"mode\":\"%s\",\"r\":%u,\"g\":%u,\"b\":%u,"
                "\"brightness\":%u,\"simulated\":%s}}",
        DPA_PLAYER_SIM_MODE ? "true" : "false",
        dpa_wifi_ap_ssid(), DPA_PLAYER_AP_IP, dpa_wifi_ap_station_count(),
        sd.mounted ? "true" : "false",
        DPA_PLAYER_SIM_SD ? "true" : "false",
        (unsigned long long)sd.total_bytes,
        (unsigned long long)sd.used_bytes,
        (unsigned long long)sd.free_bytes,
        (unsigned)sd.speed_khz,
        sd.card_name[0] ? sd.card_name : "",
        (unsigned)lib_count,
        audio_state_name(audio.state),
        (unsigned)audio.track_id, (unsigned)audio.position_ms,
        (unsigned)audio.duration_ms, (unsigned)audio.volume,
        audio.shuffle ? "true" : "false",
        repeat_name(audio.repeat),
        audio.simulated ? "true" : "false",
        dpa_led_mode_name(led.mode),
        led.r, led.g, led.b, led.brightness,
        led.simulated ? "true" : "false");
    httpd_resp_set_type(req, "application/json");
    cors(req);
    return httpd_resp_send(req, body, n);
}

/* ------- library ------------------------------------------------ */

/* GET /api/library — streamed JSON array of every indexed track.
 * We emit directly into the HTTP socket in chunks so we never
 * allocate one big buffer for the whole list. */
static esp_err_t library_get(httpd_req_t *req)
{
    httpd_resp_set_type(req, "application/json");
    cors(req);

    size_t n = 0;
    const dpa_track_t *tracks = dpa_library_tracks(&n);

    /* Worst case per track: ~100 bytes JSON skeleton + 96 title +
     * 64 artist + 64 album + 160 path = ~500 bytes. 640 leaves
     * headroom for format-number expansion. */
    char chunk[640];
    int len;

    httpd_resp_send_chunk(req, "{\"count\":", 9);
    len = snprintf(chunk, sizeof(chunk), "%u,\"tracks\":[", (unsigned)n);
    httpd_resp_send_chunk(req, chunk, len);

    for (size_t i = 0; i < n; i++) {
        const dpa_track_t *t = &tracks[i];
        len = snprintf(chunk, sizeof(chunk),
            "%s{\"id\":%u,\"title\":\"%s\",\"artist\":\"%s\","
            "\"album\":\"%s\",\"kind\":\"%s\",\"durationMs\":%u,"
            "\"sampleRate\":%u,\"channels\":%u,\"bits\":%u,"
            "\"bytes\":%u,\"simulated\":%s,\"path\":\"%s\"}",
            (i == 0) ? "" : ",",
            (unsigned)t->id, t->title, t->artist, t->album,
            dpa_library_kind_name(t->kind),
            (unsigned)t->duration_ms, (unsigned)t->sample_rate,
            (unsigned)t->channels, (unsigned)t->bits_per_sample,
            (unsigned)t->payload_size,
            t->simulated ? "true" : "false",
            t->path);
        httpd_resp_send_chunk(req, chunk, len);
    }
    httpd_resp_send_chunk(req, "]}", 2);
    httpd_resp_send_chunk(req, NULL, 0);   /* terminate chunked body */
    return ESP_OK;
}

/* POST /api/library/rescan — drops the index and re-walks the SD. */
static esp_err_t library_rescan_post(httpd_req_t *req)
{
    int n = dpa_library_rescan();
    char body[64];
    int len = snprintf(body, sizeof(body), "{\"count\":%d}", n);
    httpd_resp_set_type(req, "application/json");
    cors(req);
    return httpd_resp_send(req, body, len);
}

/* ------- player -------------------------------------------------- */

static void write_player_json(char *body, size_t size, int *out_len)
{
    dpa_audio_status_t a = {0};
    dpa_audio_get_status(&a);
    const dpa_track_t *t = dpa_audio_current_track();

    *out_len = snprintf(body, size,
        "{\"state\":\"%s\",\"trackId\":%u,\"positionMs\":%u,"
        "\"durationMs\":%u,\"volume\":%u,\"shuffle\":%s,\"repeat\":\"%s\","
        "\"simulated\":%s,\"track\":%s%s%s}",
        audio_state_name(a.state), (unsigned)a.track_id,
        (unsigned)a.position_ms, (unsigned)a.duration_ms,
        (unsigned)a.volume, a.shuffle ? "true" : "false",
        repeat_name(a.repeat),
        a.simulated ? "true" : "false",
        t ? "{\"title\":\"" : "null",
        t ? t->title : "",
        t ? "\"}"  : "");
}

/* GET /api/player */
static esp_err_t player_get(httpd_req_t *req)
{
    char body[512];
    int len = 0;
    write_player_json(body, sizeof(body), &len);
    httpd_resp_set_type(req, "application/json");
    cors(req);
    return httpd_resp_send(req, body, len);
}

/* Shared — read an optional query-string uint param. Returns
 * -1 if not present or unparsable. */
static long query_long(httpd_req_t *req, const char *key, long fallback)
{
    size_t qlen = httpd_req_get_url_query_len(req);
    if (qlen == 0 || qlen > 128) return fallback;
    char q[130];
    if (httpd_req_get_url_query_str(req, q, sizeof(q)) != ESP_OK) return fallback;
    char v[32];
    if (httpd_query_key_value(q, key, v, sizeof(v)) != ESP_OK) return fallback;
    return strtol(v, NULL, 10);
}

static esp_err_t player_play_post(httpd_req_t *req)
{
    long id = query_long(req, "id", 0);
    esp_err_t err = dpa_audio_play((uint32_t)(id > 0 ? id : 0));
    if (err == ESP_ERR_NOT_FOUND) {
        httpd_resp_set_status(req, "404 Not Found");
        cors(req);
        return httpd_resp_send(req, "{\"error\":\"no track\"}", 20);
    }
    return player_get(req);
}

static esp_err_t player_pause_post(httpd_req_t *req)
{
    dpa_audio_pause();
    return player_get(req);
}

static esp_err_t player_stop_post(httpd_req_t *req)
{
    dpa_audio_stop();
    return player_get(req);
}

static esp_err_t player_next_post(httpd_req_t *req)
{
    dpa_audio_next();
    return player_get(req);
}

static esp_err_t player_prev_post(httpd_req_t *req)
{
    dpa_audio_prev();
    return player_get(req);
}

static esp_err_t player_seek_post(httpd_req_t *req)
{
    long ms = query_long(req, "ms", 0);
    if (ms < 0) ms = 0;
    dpa_audio_seek((uint32_t)ms);
    return player_get(req);
}

static esp_err_t player_volume_post(httpd_req_t *req)
{
    long v = query_long(req, "v", 70);
    if (v < 0) v = 0; if (v > 100) v = 100;
    dpa_audio_set_volume((uint8_t)v);
    return player_get(req);
}

static esp_err_t player_shuffle_post(httpd_req_t *req)
{
    long on = query_long(req, "on", 0);
    dpa_audio_set_shuffle(on != 0);
    return player_get(req);
}

static esp_err_t player_repeat_post(httpd_req_t *req)
{
    long mode = query_long(req, "mode", 0);
    if (mode < 0 || mode > 2) mode = 0;
    dpa_audio_set_repeat((dpa_repeat_mode_t)mode);
    return player_get(req);
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
static const httpd_uri_t uri_library = {
    .uri = "/api/library", .method = HTTP_GET, .handler = library_get,
};
static const httpd_uri_t uri_library_rescan = {
    .uri = "/api/library/rescan", .method = HTTP_POST, .handler = library_rescan_post,
};
static const httpd_uri_t uri_player = {
    .uri = "/api/player", .method = HTTP_GET, .handler = player_get,
};
static const httpd_uri_t uri_player_play = {
    .uri = "/api/player/play",    .method = HTTP_POST, .handler = player_play_post,
};
static const httpd_uri_t uri_player_pause = {
    .uri = "/api/player/pause",   .method = HTTP_POST, .handler = player_pause_post,
};
static const httpd_uri_t uri_player_stop = {
    .uri = "/api/player/stop",    .method = HTTP_POST, .handler = player_stop_post,
};
static const httpd_uri_t uri_player_next = {
    .uri = "/api/player/next",    .method = HTTP_POST, .handler = player_next_post,
};
static const httpd_uri_t uri_player_prev = {
    .uri = "/api/player/prev",    .method = HTTP_POST, .handler = player_prev_post,
};
static const httpd_uri_t uri_player_seek = {
    .uri = "/api/player/seek",    .method = HTTP_POST, .handler = player_seek_post,
};
static const httpd_uri_t uri_player_volume = {
    .uri = "/api/player/volume",  .method = HTTP_POST, .handler = player_volume_post,
};
static const httpd_uri_t uri_player_shuffle = {
    .uri = "/api/player/shuffle", .method = HTTP_POST, .handler = player_shuffle_post,
};
static const httpd_uri_t uri_player_repeat = {
    .uri = "/api/player/repeat",  .method = HTTP_POST, .handler = player_repeat_post,
};

esp_err_t dpa_http_srv_start(void)
{
    if (s_server) {
        return ESP_OK;
    }
    httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
    cfg.server_port    = DPA_PLAYER_HTTP_PORT;
    cfg.max_uri_handlers = 24;
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
    httpd_register_uri_handler(s_server, &uri_library);
    httpd_register_uri_handler(s_server, &uri_library_rescan);
    httpd_register_uri_handler(s_server, &uri_player);
    httpd_register_uri_handler(s_server, &uri_player_play);
    httpd_register_uri_handler(s_server, &uri_player_pause);
    httpd_register_uri_handler(s_server, &uri_player_stop);
    httpd_register_uri_handler(s_server, &uri_player_next);
    httpd_register_uri_handler(s_server, &uri_player_prev);
    httpd_register_uri_handler(s_server, &uri_player_seek);
    httpd_register_uri_handler(s_server, &uri_player_volume);
    httpd_register_uri_handler(s_server, &uri_player_shuffle);
    httpd_register_uri_handler(s_server, &uri_player_repeat);

    httpd_register_err_handler(s_server, HTTPD_404_NOT_FOUND, not_found);

    ESP_LOGI(TAG, "HTTP server ready on port %d", DPA_PLAYER_HTTP_PORT);
    return ESP_OK;
}

httpd_handle_t dpa_http_srv_handle(void)
{
    return s_server;
}
