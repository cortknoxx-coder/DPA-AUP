# DPA Player — main component
# Populated progressively per phase. Each new subsystem lands its .c
# file + its REQUIRES bump here.
#
#   Phase 1:  wifi_ap.c + captive_dns.c + http_srv.c   [done]
#   Phase 2a: sd_card.c                                [done, SIM path]
#   Phase 2b: dpa_format.c + library.c                 [done, SIM path]
#   Phase 3:  http_srv.c /api/library + /api/player/*  [done]
#   Phase 4:  audio.c                                  [done, SIM transport]
#             (Phase 4b will add dr_flac + i2s_std)
#   Phase 5:  led.c                                    [done, SIM logs]
#             (Phase 5b will add led_strip RMT backend)

idf_component_register(
    SRCS
        "main.c"
        "wifi_ap.c"
        "captive_dns.c"
        "http_srv.c"
        "sd_card.c"
        "dpa_format.c"
        "library.c"
        "audio.c"
        "led.c"
    INCLUDE_DIRS
        "."
    REQUIRES
        esp_system
        esp_event
        esp_wifi
        esp_netif
        esp_http_server
        esp_timer
        nvs_flash
        lwip
        log
        fatfs
        sdmmc
        driver
)
