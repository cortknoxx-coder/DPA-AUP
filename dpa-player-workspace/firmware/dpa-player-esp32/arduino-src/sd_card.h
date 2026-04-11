/*
 * DPA SD Card Manager — sd_card.h
 * ESP-IDF native SDSPI mount + POSIX file I/O
 *
 * Uses esp_vfs_fat_sdspi_mount() for SD initialization, giving:
 *   - Direct SPI bus control via spi_bus_initialize()
 *   - Clock speed switching via sdmmc_host without unmount/remount
 *   - FATFS statistics via f_getfree()
 *   - Standard POSIX file ops: fopen/fread/fseek/opendir/readdir
 *
 * All file paths must be prefixed with SD_MOUNT ("/sd").
 * Use sdPath("/tracks/song.wav") for runtime path construction.
 *
 * Wiring (Waveshare ESP32-S3 Zero):
 *   CS   → GP10
 *   MOSI → GP11
 *   SCK  → GP12
 *   MISO → GP13
 */

#ifndef DPA_SD_CARD_H
#define DPA_SD_CARD_H

#include <Arduino.h>  // String, Serial, millis, delay, pinMode, digitalWrite
#include <esp_vfs_fat.h>
#include <sdmmc_cmd.h>
#include <driver/sdspi_host.h>
#include <driver/spi_common.h>
#include <sys/stat.h>
#include <dirent.h>
#include <unistd.h>

// ── Mount point ─────────────────────────────────────────────
#define SD_MOUNT "/sd"

// ── Pin Defaults for Waveshare ESP32-S3 Zero + Adafruit SPI storage ──
#ifndef DPA_SD_CS_PIN
#define DPA_SD_CS_PIN   10
#endif

#ifndef DPA_SD_SCK_PIN
#define DPA_SD_SCK_PIN  12
#endif

#ifndef DPA_SD_MISO_PIN
#define DPA_SD_MISO_PIN 13
#endif

#ifndef DPA_SD_MOSI_PIN
#define DPA_SD_MOSI_PIN 11
#endif

// SD clock speeds (kHz for ESP-IDF API)
#define SD_SLOW_KHZ   400       // 400kHz — reliable for XTSD writes/uploads
#define SD_FAST_KHZ   20000     // 20MHz — proven for audio playback

// ── Globals owned by .ino ────────────────────────────────────
extern bool  g_sdMounted;
extern float g_sdTotalMB;
extern float g_sdUsedMB;
extern float g_sdFreeMB;
extern int   g_sdFileCount;

// Card handle (valid after mount)
static sdmmc_card_t* g_sdCard = nullptr;

// SPI host slot (needed for clock speed changes)
static sdspi_dev_handle_t g_sdspiHandle = 0;
static sdmmc_host_t g_sdHost;

// Current clock speed (kHz)
static uint32_t g_sdCurrentKHz = 0;

// ── Path Helper ─────────────────────────────────────────────
// Prepend mount point to a relative path: sdPath("/tracks/song.wav")
static String sdPath(const String& relPath) {
  return String(SD_MOUNT) + relPath;
}

// ── JSON escape helper ──────────────────────────────────────
static String dpaJsonEscape(const String& s) {
  String out = s;
  out.replace("\\", "\\\\");
  out.replace("\"", "\\\"");
  return out;
}

// ── File existence check ────────────────────────────────────
static bool sdExists(const String& relPath) {
  String full = sdPath(relPath);
  struct stat st;
  return (stat(full.c_str(), &st) == 0);
}

static bool sdExists(const char* relPath) {
  return sdExists(String(relPath));
}

// ── Create directory ────────────────────────────────────────
static bool sdMkdir(const String& relPath) {
  String full = sdPath(relPath);
  return (mkdir(full.c_str(), 0755) == 0 || errno == EEXIST);
}

static bool sdMkdir(const char* relPath) {
  return sdMkdir(String(relPath));
}

// ── Remove file ─────────────────────────────────────────────
static bool sdRemove(const String& relPath) {
  String full = sdPath(relPath);
  return (unlink(full.c_str()) == 0);
}

static bool sdRemove(const char* relPath) {
  return sdRemove(String(relPath));
}

// ── Rename file ─────────────────────────────────────────────
static bool sdRename(const String& from, const String& to) {
  String fullFrom = sdPath(from);
  String fullTo   = sdPath(to);
  return (rename(fullFrom.c_str(), fullTo.c_str()) == 0);
}

// ── File size ───────────────────────────────────────────────
static size_t sdFileSize(const String& relPath) {
  String full = sdPath(relPath);
  struct stat st;
  if (stat(full.c_str(), &st) == 0) return st.st_size;
  return 0;
}

// ── Open file (POSIX) ───────────────────────────────────────
// Convenience: opens with mount-point prefix
static FILE* sdFopen(const String& relPath, const char* mode) {
  String full = sdPath(relPath);
  return fopen(full.c_str(), mode);
}

static FILE* sdFopen(const char* relPath, const char* mode) {
  return sdFopen(String(relPath), mode);
}

// ── Clock Speed Switching ───────────────────────────────────
// Change SPI clock speed WITHOUT unmount/remount (ESP-IDF native)
static bool sdSetSpeed(uint32_t kHz) {
  if (!g_sdMounted || !g_sdCard) return false;
  if (g_sdCurrentKHz == kHz) return true;  // already at this speed

  Serial.printf("[SD] Speed: %lu → %lu kHz\n",
    (unsigned long)g_sdCurrentKHz, (unsigned long)kHz);

  // Use host set_card_clk to change speed in-place
  esp_err_t err = sdspi_host_set_card_clk(g_sdHost.slot, kHz);
  if (err == ESP_OK) {
    g_sdCurrentKHz = kHz;
    return true;
  }
  Serial.printf("[SD] Speed change failed: %s\n", esp_err_to_name(err));
  return false;
}

// Convenience wrappers
static bool sdMountFast() { return sdSetSpeed(SD_FAST_KHZ); }
static bool sdMountSlow() { return sdSetSpeed(SD_SLOW_KHZ); }

// Legacy compatibility for code that calls sdRemount()
static bool sdRemount(uint32_t hz) {
  return sdSetSpeed(hz / 1000);  // convert Hz to kHz
}

// ── Refresh Card Stats ──────────────────────────────────────
static void sdRefreshStats() {
  extern volatile bool g_audioPlaying;
  if (g_audioPlaying) return;  // don't touch SD during playback

  if (!g_sdMounted || !g_sdCard) {
    g_sdTotalMB = 0;
    g_sdUsedMB = 0;
    g_sdFreeMB = 0;
    g_sdFileCount = 0;
    return;
  }

  // Card capacity from CSD register
  uint64_t totalBytes = (uint64_t)g_sdCard->csd.capacity *
                        (uint64_t)(g_sdCard->csd.sector_size
                          ? g_sdCard->csd.sector_size : 512);
  g_sdTotalMB = (float)totalBytes / (1024.0f * 1024.0f);

  // Free space from FATFS (O(1) — reads FAT metadata)
  FATFS* fs;
  DWORD free_clusters;
  char drv[8];
  snprintf(drv, sizeof(drv), "%s/", SD_MOUNT);  // e.g. "/sd/"
  if (f_getfree("0:", &free_clusters, &fs) == FR_OK) {
    uint64_t freeBytes = (uint64_t)free_clusters * fs->csize *
                         (fs->ssize ? fs->ssize : 512);
    g_sdFreeMB = (float)freeBytes / (1024.0f * 1024.0f);
    g_sdUsedMB = g_sdTotalMB - g_sdFreeMB;
    if (g_sdUsedMB < 0) g_sdUsedMB = 0;
  }

  g_sdFileCount = 0;  // populated by scanWavList
}

// ── Mount SD Card ───────────────────────────────────────────
static bool sdInit() {
  g_sdMounted   = false;
  g_sdTotalMB   = 0;
  g_sdUsedMB    = 0;
  g_sdFreeMB    = 0;
  g_sdFileCount = 0;

  // ── Initialize SPI bus ──
  spi_bus_config_t bus_cfg = {};
  bus_cfg.mosi_io_num   = DPA_SD_MOSI_PIN;
  bus_cfg.miso_io_num   = DPA_SD_MISO_PIN;
  bus_cfg.sclk_io_num   = DPA_SD_SCK_PIN;
  bus_cfg.quadwp_io_num = -1;
  bus_cfg.quadhd_io_num = -1;
  bus_cfg.max_transfer_sz = 4000;

  esp_err_t err = spi_bus_initialize(SPI2_HOST, &bus_cfg, SDSPI_DEFAULT_DMA);
  if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
    // ESP_ERR_INVALID_STATE means bus already initialized — that's OK
    Serial.printf("[SD] SPI bus init failed: %s\n", esp_err_to_name(err));
    Serial.printf("[SD] Pins: CS=GP%d, MOSI=GP%d, SCK=GP%d, MISO=GP%d\n",
      DPA_SD_CS_PIN, DPA_SD_MOSI_PIN, DPA_SD_SCK_PIN, DPA_SD_MISO_PIN);
    return false;
  }

  // ── Configure SD host (SPI mode) ──
  g_sdHost = (sdmmc_host_t)SDSPI_HOST_DEFAULT();
  g_sdHost.max_freq_khz = SD_SLOW_KHZ;  // start slow for reliable init

  sdspi_device_config_t slot_cfg = SDSPI_DEVICE_CONFIG_DEFAULT();
  slot_cfg.gpio_cs   = (gpio_num_t)DPA_SD_CS_PIN;
  slot_cfg.host_id   = SPI2_HOST;

  // ── Mount FATFS ──
  esp_vfs_fat_sdmmc_mount_config_t mount_cfg = {};
  mount_cfg.format_if_mount_failed = false;
  mount_cfg.max_files = 8;
  mount_cfg.allocation_unit_size = 16 * 1024;

  // Try speeds: 400kHz (most reliable), then 1MHz, then 4MHz
  uint32_t speeds[] = { SD_SLOW_KHZ, 1000, 4000 };
  for (int i = 0; i < 3; i++) {
    g_sdHost.max_freq_khz = speeds[i];
    Serial.printf("[SD] Trying %lu kHz...\n", (unsigned long)speeds[i]);

    err = esp_vfs_fat_sdspi_mount(SD_MOUNT, &g_sdHost, &slot_cfg,
                                  &mount_cfg, &g_sdCard);
    if (err == ESP_OK) {
      g_sdCurrentKHz = speeds[i];
      Serial.printf("[SD] Mounted at %lu kHz!\n", (unsigned long)speeds[i]);

      // Print card info
      sdmmc_card_print_info(stdout, g_sdCard);
      break;
    }

    Serial.printf("[SD] Mount at %lu kHz failed: %s\n",
      (unsigned long)speeds[i], esp_err_to_name(err));
    delay(100);
  }

  if (err != ESP_OK) {
    Serial.println("[SD] Mount FAILED — check wiring/power");
    Serial.printf("[SD] Pins: CS=GP%d, MOSI=GP%d, SCK=GP%d, MISO=GP%d\n",
      DPA_SD_CS_PIN, DPA_SD_MOSI_PIN, DPA_SD_SCK_PIN, DPA_SD_MISO_PIN);
    return false;
  }

  g_sdMounted = true;

  // Read card stats
  sdRefreshStats();

  // Ensure required directories exist
  sdMkdir("/data");
  sdMkdir("/tracks");

  Serial.printf("[SD] mounted: total=%.2fMB used=%.2fMB free=%.2fMB\n",
                g_sdTotalMB, g_sdUsedMB, g_sdFreeMB);
  return true;
}

// ── List Files as JSON ──────────────────────────────────────
static const int SD_MAX_FILE_SCAN = 200;

static String sdListFilesJson(const char* dirRelPath) {
  extern volatile bool g_audioPlaying;
  if (g_audioPlaying) return "[]";
  if (!g_sdMounted) return "[]";

  String fullPath = sdPath(dirRelPath);
  DIR* dir = opendir(fullPath.c_str());
  if (!dir) return "[]";

  String json = "[";
  bool first = true;
  int count = 0;

  struct dirent* entry;
  while ((entry = readdir(dir)) != nullptr && count < SD_MAX_FILE_SCAN) {
    // Skip hidden/system files
    if (entry->d_name[0] == '.') continue;

    if (!first) json += ",";
    first = false;

    String name = String(entry->d_name);

    // Get file size via stat
    String entryPath = fullPath + "/" + name;
    struct stat st;
    size_t fileSize = 0;
    bool isDir = (entry->d_type == DT_DIR);
    if (stat(entryPath.c_str(), &st) == 0) {
      fileSize = st.st_size;
      isDir = S_ISDIR(st.st_mode);
    }

    json += "{";
    json += "\"name\":\"" + dpaJsonEscape(name) + "\",";
    json += "\"path\":\"" + dpaJsonEscape(name) + "\",";
    json += "\"size\":" + String((unsigned long)fileSize) + ",";
    json += "\"isDir\":" + String(isDir ? "true" : "false");
    json += "}";

    count++;
  }

  closedir(dir);
  return json + "]";
}

#endif // DPA_SD_CARD_H
