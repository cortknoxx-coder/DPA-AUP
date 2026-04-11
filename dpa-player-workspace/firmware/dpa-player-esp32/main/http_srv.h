/*
 * DPA Player — HTTP server (pure ESP-IDF)
 * ----------------------------------------
 * Minimal esp_http_server instance serving the captive portal
 * landing + OS-specific captive-probe URLs. Phase 3 layers the real
 * JSON API on top of this.
 */

#ifndef DPA_PLAYER_HTTP_SRV_H
#define DPA_PLAYER_HTTP_SRV_H

#include "esp_err.h"
#include "esp_http_server.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Starts the HTTP server on DPA_PLAYER_HTTP_PORT. */
esp_err_t dpa_http_srv_start(void);

/* Returns the underlying httpd handle so other modules can register
 * their own URI handlers (e.g. Phase 3 JSON API). NULL before start. */
httpd_handle_t dpa_http_srv_handle(void);

#ifdef __cplusplus
}
#endif

#endif /* DPA_PLAYER_HTTP_SRV_H */
