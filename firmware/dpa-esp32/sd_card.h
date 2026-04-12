/*
 * DPA SD Card Manager — sd_card.h
 * SPI SD card via Adafruit microSD module
 * Supports speed switching: slow for reliable writes, fast for playback
 *
 * Wiring (Waveshare ESP32-S3 Zero):
 *   CS   → GP10
 *   MOSI → GP11
 *   SCK  → GP12
 *   MISO → GP13
 */

#ifndef DPA_SD_CARD_H
#define DPA_SD_CARD_H

#include <Arduino.h>
#include <FS.h>
#include <SPI.h>
#include <SD.h>

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

// SD clock speeds
#define SD_SLOW_HZ   400000      // 400kHz — reliable for XTSD writes/uploads
#define SD_FAST_HZ   20000000    // 20MHz — proven for audio playback
#define SD_UPLOAD_WARM_HZ  1000000   // 1MHz — safer step-up for writes
#define SD_UPLOAD_MEDIUM_HZ 4000000  // 4MHz — usually stable on this module
#define SD_UPLOAD_TURBO_HZ  8000000  // 8MHz — try first, fall back if probe fails
#define SD_BOOT_SETTLE_MS 450    // brief power/card settle before first mount
#define SD_WRITE_PROBE_BYTES 1024 // tiny temp-file probe before real uploads

// ── Globals owned by .ino ────────────────────────────────────
extern bool  g_sdMounted;
extern float g_sdTotalMB;
extern float g_sdUsedMB;
extern float g_sdFreeMB;
extern int   g_sdFileCount;

// Current SD mount speed
static uint32_t g_sdCurrentHz = 0;
static uint32_t g_sdPreferredUploadHz = 0;

// Track if SPI bus is initialized
static bool g_sdSpiReady = false;

// ── Internal Helpers ─────────────────────────────────────────
static const int SD_MAX_FILE_SCAN = 200;
static const int SD_MAX_WALK_DEPTH = 4;
static const unsigned long SD_MAX_WALK_MS = 1500;

// Hardened recursive walker. Kept around for sdListFilesJson use cases.
// Boot path no longer calls this — it uses SD.usedBytes() (O(1) FAT read)
// because a walk at 400kHz can hang on corrupted entries or macOS
// AppleDouble files and brick boot.
static uint64_t dpaCountDirBytes(File dir, int& fileCount, int depth = 0,
                                 unsigned long deadline = 0) {
  uint64_t total = 0;
  if (!dir || !dir.isDirectory()) return 0;
  if (depth >= SD_MAX_WALK_DEPTH) return 0;
  if (deadline == 0) deadline = millis() + SD_MAX_WALK_MS;

  File entry = dir.openNextFile();
  while (entry) {
    if (millis() > deadline) { entry.close(); break; }
    if (fileCount >= SD_MAX_FILE_SCAN) { entry.close(); break; }
    yield();
    const char* nm = entry.name();
    // Skip macOS AppleDouble + hidden metadata that can trip SD parsers
    bool skip = (nm && (nm[0] == '.' ||
                        strstr(nm, "Spotlight") ||
                        strstr(nm, "Trashes") ||
                        strstr(nm, "fseventsd")));
    if (!skip) {
      if (entry.isDirectory()) {
        total += dpaCountDirBytes(entry, fileCount, depth + 1, deadline);
      } else {
        total += entry.size();
        fileCount++;
      }
    }
    entry.close();
    entry = dir.openNextFile();
  }
  return total;
}

static String dpaJsonEscape(const String& s) {
  String out = s;
  out.replace("\\", "\\\\");
  out.replace("\"", "\\\"");
  return out;
}

static bool sdWriteProbeCurrentMount() {
  if (!g_sdMounted) return false;

  const char* probePath = "/.dpa-upload-probe.tmp";
  uint8_t probeBuf[SD_WRITE_PROBE_BYTES];
  memset(probeBuf, 0xA5, sizeof(probeBuf));

  if (SD.exists(probePath)) SD.remove(probePath);

  File probe = SD.open(probePath, FILE_WRITE);
  if (!probe) {
    Serial.printf("[SD] Write probe open failed at %lu Hz\n", (unsigned long)g_sdCurrentHz);
    return false;
  }

  size_t wrote = probe.write(probeBuf, sizeof(probeBuf));
  probe.flush();
  probe.close();

  bool ok = (wrote == sizeof(probeBuf));
  if (ok) {
    File verify = SD.open(probePath, FILE_READ);
    if (!verify) {
      ok = false;
    } else {
      ok = (verify.size() == sizeof(probeBuf));
      verify.close();
    }
  }

  if (SD.exists(probePath)) SD.remove(probePath);

  Serial.printf("[SD] Write probe %s at %lu Hz\n",
    ok ? "OK" : "FAIL",
    (unsigned long)g_sdCurrentHz);
  return ok;
}

static void sdPopulateStats() {
  uint64_t totalBytes = SD.cardSize();
  if (totalBytes > 0) {
    g_sdTotalMB = (float)totalBytes / (1024.0f * 1024.0f);
  }

  // Use FAT metadata for used-bytes (O(1), no directory walk).
  // A recursive walker at 400kHz can hang boot if root contains pathological
  // entries. Real track count is populated by scanWavList() on /tracks only.
  uint64_t usedBytes = SD.usedBytes();
  g_sdFileCount = 0;
  g_sdUsedMB = (float)usedBytes / (1024.0f * 1024.0f);
  g_sdFreeMB = g_sdTotalMB - g_sdUsedMB;
  if (g_sdFreeMB < 0) g_sdFreeMB = 0;
}

static void sdEnsureCoreDirs() {
  if (!SD.exists("/data")) {
    SD.mkdir("/data");
    Serial.println("[SD] Created /data directory");
  }

  if (!SD.exists("/tracks")) {
    SD.mkdir("/tracks");
    Serial.println("[SD] Created /tracks directory");
  }
}

// ── Mount SD at a specific speed ─────────────────────────────
static bool sdMountAt(uint32_t hz) {
  g_sdMounted = false;

  // Unmount first if already mounted
  SD.end();
  delay(50);

  // Init SPI bus
  pinMode(DPA_SD_CS_PIN, OUTPUT);
  digitalWrite(DPA_SD_CS_PIN, HIGH);
  delay(50);

  if (g_sdSpiReady) {
    SPI.end();
    delay(50);
  }
  SPI.begin(DPA_SD_SCK_PIN, DPA_SD_MISO_PIN, DPA_SD_MOSI_PIN, DPA_SD_CS_PIN);
  g_sdSpiReady = true;
  delay(100);

  // Try to mount with retries
  for (int attempt = 1; attempt <= 5; attempt++) {
    Serial.printf("[SD] Mount attempt %d at %lu Hz...\n", attempt, (unsigned long)hz);

    SD.end();
    delay(100);
    digitalWrite(DPA_SD_CS_PIN, HIGH);
    delay(50);

    if (SD.begin(DPA_SD_CS_PIN, SPI, hz)) {
      uint8_t cardType = SD.cardType();
      if (cardType != CARD_NONE) {
        g_sdCurrentHz = hz;
        g_sdMounted = true;
        Serial.printf("[SD] Mounted at %lu Hz\n", (unsigned long)hz);
        return true;
      }
      SD.end();
    } else {
      Serial.println("[SD] SD.begin failed");
    }
    delay(120 * attempt);
  }

  return false;
}

// ── Remount SD at a different speed ─────────────────────────
// Use before playback (fast) or before upload (slow)
static bool sdRemount(uint32_t hz) {
  if (g_sdCurrentHz == hz && g_sdMounted) {
    return true; // already at this speed
  }
  Serial.printf("[SD] Remounting: %lu Hz → %lu Hz\n",
    (unsigned long)g_sdCurrentHz, (unsigned long)hz);
  bool ok = sdMountAt(hz);
  g_sdMounted = ok;
  return ok;
}

// Convenience wrappers
static bool sdMountFast() { return sdRemount(SD_FAST_HZ); }
static bool sdMountSlow() { return sdRemount(SD_SLOW_HZ); }
static bool sdMountUploadAuto() {
  uint32_t speeds[] = {
    g_sdPreferredUploadHz,
    SD_UPLOAD_TURBO_HZ,
    SD_UPLOAD_MEDIUM_HZ,
    SD_UPLOAD_WARM_HZ,
    SD_SLOW_HZ
  };

  for (size_t i = 0; i < (sizeof(speeds) / sizeof(speeds[0])); i++) {
    uint32_t hz = speeds[i];
    if (hz == 0) continue;

    bool duplicate = false;
    for (size_t j = 0; j < i; j++) {
      if (speeds[j] == hz) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) continue;

    if (!sdRemount(hz)) continue;
    if (!sdWriteProbeCurrentMount()) continue;

    g_sdPreferredUploadHz = hz;
    Serial.printf("[SD] Upload speed selected: %lu Hz\n", (unsigned long)hz);
    return true;
  }

  g_sdPreferredUploadHz = 0;
  return false;
}
static bool sdMountUploadSafe() { return sdMountSlow(); }

// ── Public API ───────────────────────────────────────────────
static bool sdInit() {
  g_sdMounted = false;
  g_sdTotalMB = 0;
  g_sdUsedMB  = 0;
  g_sdFreeMB  = 0;
  g_sdFileCount = 0;

  // Initial mount: try slow first (most reliable for XTSD), then faster
  uint32_t speeds[] = { SD_SLOW_HZ, 1000000, 4000000 };
  bool mounted = false;

  // Give the card and regulator a bounded settle window on cold boot.
  pinMode(DPA_SD_CS_PIN, OUTPUT);
  digitalWrite(DPA_SD_CS_PIN, HIGH);
  for (int elapsed = 0; elapsed < SD_BOOT_SETTLE_MS; elapsed += 75) {
    delay(75);
    yield();
  }

  for (int i = 0; i < 3; i++) {
    if (sdMountAt(speeds[i])) {
      mounted = true;
      break;
    }
  }

  if (!mounted) {
    Serial.println("[SD] Mount FAILED — check wiring/power");
    Serial.printf("[SD] Pins: CS=GP%d, MOSI=GP%d, SCK=GP%d, MISO=GP%d\n",
      DPA_SD_CS_PIN, DPA_SD_MOSI_PIN, DPA_SD_SCK_PIN, DPA_SD_MISO_PIN);
    return false;
  }

  g_sdMounted = true;
  sdPopulateStats();
  sdEnsureCoreDirs();

  Serial.printf("[SD] mounted: total=%.2fMB used=%.2fMB free=%.2fMB files=%d\n",
                g_sdTotalMB, g_sdUsedMB, g_sdFreeMB, g_sdFileCount);

  return true;
}

static void sdRefreshStats() {
  // NEVER refresh during audio playback — directory walk blocks SPI bus
  extern volatile bool g_audioPlaying;
  if (g_audioPlaying) return;

  if (!g_sdMounted) {
    g_sdTotalMB = 0;
    g_sdUsedMB = 0;
    g_sdFreeMB = 0;
    g_sdFileCount = 0;
    return;
  }

  sdPopulateStats();
}

static String sdListFilesJson(const char* dirPath) {
  // Block directory reads during playback — causes stutter
  extern volatile bool g_audioPlaying;
  if (g_audioPlaying) return "[]";
  if (!g_sdMounted) return "[]";

  File dir = SD.open(dirPath);
  if (!dir || !dir.isDirectory()) {
    if (dir) dir.close();
    return "[]";
  }

  String json = "[";
  bool first = true;

  int count = 0;
  File entry = dir.openNextFile();
  while (entry && count < SD_MAX_FILE_SCAN) {
    if (!first) json += ",";
    first = false;

    String name = entry.name();

    json += "{";
    json += "\"name\":\"" + dpaJsonEscape(name) + "\",";
    json += "\"path\":\"" + dpaJsonEscape(name) + "\",";
    json += "\"size\":" + String((unsigned long)entry.size()) + ",";
    json += "\"isDir\":" + String(entry.isDirectory() ? "true" : "false");
    json += "}";

    entry.close();
    count++;
    entry = dir.openNextFile();
  }
  if (entry) entry.close();

  json += "]";
  dir.close();
  return json;
}

#endif // DPA_SD_CARD_H
