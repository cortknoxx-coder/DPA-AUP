# DPA Player — main component
# Populated progressively per phase. Each new subsystem lands its .c
# file + its REQUIRES bump here.
#
#   Phase 1: wifi_ap.c + captive_dns.c + http_srv.c   [done]
#   Phase 2a: sd_card.c                               [current]
#   Phase 2b: dpa_format.c + library.c                (next)
#   Phase 3: json_api.c   (JSON endpoints on the Phase 1 httpd handle)
#   Phase 4: audio.c      (dr_flac + i2s_std)
#   Phase 5: led.c        (led_strip RMT)

idf_component_register(
    SRCS
        "main.c"
        "wifi_ap.c"
        "captive_dns.c"
        "http_srv.c"
        "sd_card.c"
    INCLUDE_DIRS
        "."
    REQUIRES
        esp_system
        esp_event
        esp_wifi
        esp_netif
        esp_http_server
        nvs_flash
        lwip
        log
        fatfs
        sdmmc
        driver
)
