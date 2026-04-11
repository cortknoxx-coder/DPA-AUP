# DPA Player — main component
# Start minimal. Add source files here as phases port each subsystem:
#   Phase 1: wifi.c       (esp_wifi native AP)
#   Phase 2: sd_card.c    (esp_vfs_fat_sdspi_mount)
#   Phase 3: http_api.c   (esp_http_server)
#   Phase 4: audio.c      (dr_flac + i2s_std)
#   Phase 5: led.c        (led_strip RMT)
#   Phase 6: library.c    (multi-folder scanner + shuffle + EQ)

idf_component_register(
    SRCS        "main.c"
    INCLUDE_DIRS "."
    REQUIRES    esp_system esp_event nvs_flash
)
