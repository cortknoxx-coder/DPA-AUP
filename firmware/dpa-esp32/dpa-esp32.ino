/*
 * DPA ESP32-S3 Dashboard Firmware — Phase 2
 * ──────────────────────────────────────────
 * Hardware: Waveshare ESP32-S3 Zero (8MB flash, embedded 8MB PSRAM)
 *           Onboard WS2812B RGB LED on GPIO 21
 *           External WS2812B strip on GPIO 5 (17 LEDs)
 *           Adafruit PCM5122 DAC via I2S (GPIO 6/7/8)
 *           Adafruit 2GB microSD via SPI (GPIO 10/11/12/13)
 *
 * Features: WiFi AP+STA + Web Dashboard + REST API + WS2812B LED
 *           SD Card (SPI) + I2S DAC (PCM5122) WAV playback
 *           FreeRTOS playback task on core 1
 *           Hardware buttons: GP0/1=play/pause, GP2=next, GP3=prev, GP4=heart
 *           Software volume control (0-100, default 70 ~-3dB)
 *           Favorites system (saved to SD /data/favorites.txt)
 *           Auto-advance to next track on playback complete
 *           WAV file upload via HTTP
 *
 * Connect your phone to the device WiFi, open 192.168.4.1
 * in a browser, and control your DPA from the dashboard.
 *
 * Libraries required (use mathieucarbou forks for Core 3.x):
 *   - FastLED
 *   - ESPAsyncWebServer  (github.com/mathieucarbou/ESPAsyncWebServer)
 *   - AsyncTCP           (github.com/mathieucarbou/AsyncTCP)
 *   - SD                 (built-in)
 *   - SPI                (built-in)
 *
 * Board settings (Arduino IDE):
 *   Board:            Waveshare ESP32-S3 Zero
 *   Flash Size:       8MB
 *   Partition Scheme: Custom single-app 8MB layout (no OTA / no SPIFFS)
 *   PSRAM:            Enabled (OPI)
 *   USB CDC On Boot:  Enabled
 *
 * Version: 2.3.0
 * Updated: 2026-04-01
 */

#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <esp_heap_caps.h>

// ── Pin Definitions ─────────────────────────────────────────
#define SD_CS    10
#define SD_MOSI  11
#define SD_SCK   12
#define SD_MISO  13

#define I2S_BCLK   6
#define I2S_LRCLK  7
#define I2S_DOUT   8

#define LED_PIN          5
#define NUM_LEDS         17
#define ONBOARD_LED_PIN  21

#define BOOT_BTN_PIN     0

// ── Hardware Button Pins (momentary, active LOW) ─────────────
#define BTN_PLAY_PIN     1   // GP1 — Play/Pause toggle
#define BTN_NEXT_PIN     2   // GP2 — Next track
#define BTN_PREV_PIN     3   // GP3 — Previous track
#define BTN_HEART_PIN    4   // GP4 — Heart/Favorite current track

// ── Battery Monitoring ──────────────────────────────────────
// Wire a voltage divider (100K/100K) from LiPo+ to BATT_ADC_PIN
// Charge detect: wire TP4056 CHRG pin or similar to BATT_CHG_PIN (LOW = charging)
// If no battery circuit is wired, firmware detects USB power and shows "USB Powered"
#define BATT_ADC_PIN     9   // GP9 — ADC1 channel, free pin
#define BATT_CHG_PIN    14   // GP14 — Charge status (LOW = charging), -1 to disable
#define BATT_DIVIDER    2.0f // Voltage divider ratio (100K/100K = 2:1)
#define BATT_V_MIN      3.0f // Empty LiPo
#define BATT_V_MAX      4.2f // Full LiPo
#define BATT_READ_INTERVAL 10000 // Read every 10 seconds

// ── Global State ─────────────────────────────────────────────

// Device identity
String g_duid       = "DPA-AB12";
String g_fwVersion  = "2.4.1";

// Admin mode (consumer-only by default, unlocked via button combo or API)
bool   g_adminMode  = false;

// Upload in progress — pauses background SPI tasks in loop()
volatile bool g_uploadInProgress = false;

// Playback state
int    g_trackIndex = 0;
bool   g_playing    = false;
int    g_volume     = 70;    // 0-100, default 70 (~-3dB comfortable level)
String g_eq         = "flat";
String g_playMode   = "normal";

// Track list (real WAVs from SD)
String g_wavPaths[32];       // up to 32 tracks
int    g_wavCount = 0;

// Favorites (hearted tracks, saved to SD)
String g_favorites[32];
int    g_favCount = 0;

// First playable WAV (scanned on boot)
String g_firstPlayableWav = "";

// LED Theme (defaults — overridden by NVS on boot)
String g_ledIdle      = "#ffffff";   // White breathing at idle (user preference)
String g_ledIdlePat   = "breathing";
String g_ledPlay      = "#00f1df";   // Overridden by cover-art color extraction on upload
String g_ledPlayPat   = "vu_classic";
String g_ledCharge    = "#ffcc33";
String g_ledChargePat = "breathing";
int    g_brightness   = 80;

// VU Gradient end color (start color = mode color above)
String g_ledGradEnd   = "#ff6600";  // default: orange gradient end

// DCNP notification colors
String g_dcnpConcert = "#ff3366";
String g_dcnpVideo   = "#3366ff";
String g_dcnpMerch   = "#33ff99";
String g_dcnpSigning = "#ffcc00";
String g_dcnpRemix   = "#cc33ff";
String g_dcnpOther   = "#ffffff";

// SD card state
bool   g_sdMounted   = false;
float  g_sdTotalMB   = 0;
float  g_sdUsedMB    = 0;
float  g_sdFreeMB    = 0;
int    g_sdFileCount = 0;
String g_sdState     = "uninitialized";

// Runtime readiness / observability
String g_bootState          = "booting";
String g_uploadState        = "idle";
String g_degradedReason     = "";
String g_httpMode           = "starting";
String g_wifiMaintenanceMode = "normal";
String g_lastUploadPath     = "";
size_t g_lastUploadBytes    = 0;
String g_lastUploadMode     = "safe";
uint32_t g_lastUploadDurationMs = 0;
uint32_t g_lastUploadRateKBps = 0;
uint32_t g_lastUploadSdHz   = 0;
bool   g_httpReady          = false;
bool   g_wifiReady          = false;
bool   g_audioHardwareVerified = false;
String g_disconnectBreadcrumbKind   = "none";
String g_disconnectBreadcrumbScope  = "none";
String g_disconnectBreadcrumbCause  = "";
String g_disconnectBreadcrumbDetail = "";
int    g_disconnectBreadcrumbReasonCode = 0;
unsigned long g_disconnectBreadcrumbAtMs = 0;
unsigned long g_disconnectBreadcrumbUptimeS = 0;
uint32_t g_disconnectBreadcrumbFreeHeap = 0;
uint32_t g_disconnectBreadcrumbLargestHeapBlock = 0;
int    g_disconnectBreadcrumbStaRssi = 0;
int    g_disconnectBreadcrumbApClients = 0;
unsigned long g_httpRestartCount = 0;
bool   g_apRecoveryPending = false;
unsigned long g_apRecoveryRequestedAtMs = 0;
unsigned long g_lastPortalHttpActivityAtMs = 0;
bool   g_portalHttpWatchdogArmed = false;
unsigned long g_lastPortalControlPlaneRestartAtMs = 0;

// Battery (real ADC on BATT_ADC_PIN, or USB-powered if no divider wired)
float  g_battVoltage = 0;
int    g_battPercent = -1;   // -1 = no battery detected (USB powered)
bool   g_charging    = false;
bool   g_battPresent = false; // true if voltage divider is wired

// ── Battery ADC Reading ─────────────────────────────────────
void batteryInit() {
  analogReadResolution(12);           // 0-4095
  analogSetAttenuation(ADC_11db);     // Full 0-3.3V range
  pinMode(BATT_ADC_PIN, INPUT);
  if (BATT_CHG_PIN >= 0) {
    pinMode(BATT_CHG_PIN, INPUT_PULLUP);
  }
  // Take initial reading
  batteryRead();
}

void batteryRead() {
  // Average 8 samples for stability
  uint32_t sum = 0;
  for (int i = 0; i < 8; i++) {
    sum += analogRead(BATT_ADC_PIN);
    delayMicroseconds(100);
  }
  float adcAvg = sum / 8.0f;
  float adcVolts = (adcAvg / 4095.0f) * 3.3f;
  float battV = adcVolts * BATT_DIVIDER;

  // Detect if battery circuit is wired:
  // If ADC reads < 0.1V or > 4.5V (after divider), no battery connected
  if (battV < 0.3f || battV > 4.5f) {
    g_battPresent = false;
    g_battVoltage = 5.0;       // USB voltage
    g_battPercent = -1;        // Signals "USB Powered" to dashboard
    g_charging = false;
    return;
  }

  g_battPresent = true;
  g_battVoltage = battV;

  // LiPo voltage-to-percent (piecewise linear approximation)
  // 4.2V=100%, 3.9V=75%, 3.7V=40%, 3.5V=15%, 3.0V=0%
  float pct;
  if      (battV >= 4.2f) pct = 100.0f;
  else if (battV >= 3.9f) pct = 75.0f + (battV - 3.9f) / 0.3f * 25.0f;
  else if (battV >= 3.7f) pct = 40.0f + (battV - 3.7f) / 0.2f * 35.0f;
  else if (battV >= 3.5f) pct = 15.0f + (battV - 3.5f) / 0.2f * 25.0f;
  else if (battV >= 3.0f) pct = (battV - 3.0f) / 0.5f * 15.0f;
  else                     pct = 0.0f;
  g_battPercent = constrain((int)pct, 0, 100);

  // Charge detection (TP4056 CHRG pin: LOW when charging)
  if (BATT_CHG_PIN >= 0) {
    g_charging = (digitalRead(BATT_CHG_PIN) == LOW);
  }
}

// Stats
unsigned long g_bootTime = 0;
int g_playCount = 0, g_pauseCount = 0;
int g_nextCount = 0, g_prevCount = 0;

static void refreshRuntimeState() {
  String degraded = "";
  if (g_sdState == "error" || !g_sdMounted) {
    degraded = "sd_unavailable";
  } else if (!g_audioHardwareVerified) {
    degraded = "audio_unverified";
  } else if (g_uploadState == "error") {
    degraded = "upload_failed";
  }

  g_degradedReason = degraded;

  if (!g_wifiReady || !g_httpReady) {
    g_bootState = "booting";
  } else if (g_degradedReason.length() > 0) {
    g_bootState = "degraded";
  } else {
    g_bootState = "ready";
  }
}

void noteDisconnectBreadcrumb(
  const String& kind,
  const String& scope,
  const String& cause,
  const String& detail,
  int reasonCode,
  int staRssiSnapshot,
  int apClientCountSnapshot,
  uint32_t freeHeapSnapshot = 0,
  uint32_t largestHeapBlockSnapshot = 0
) {
  g_disconnectBreadcrumbKind = kind;
  g_disconnectBreadcrumbScope = scope;
  g_disconnectBreadcrumbCause = cause;
  g_disconnectBreadcrumbDetail = detail;
  g_disconnectBreadcrumbReasonCode = reasonCode;
  g_disconnectBreadcrumbAtMs = millis();
  g_disconnectBreadcrumbUptimeS = g_bootTime > 0 ? ((millis() - g_bootTime) / 1000UL) : 0;
  g_disconnectBreadcrumbFreeHeap = freeHeapSnapshot > 0 ? freeHeapSnapshot : esp_get_free_heap_size();
  g_disconnectBreadcrumbLargestHeapBlock = largestHeapBlockSnapshot > 0
    ? largestHeapBlockSnapshot
    : heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
  g_disconnectBreadcrumbStaRssi = staRssiSnapshot;
  g_disconnectBreadcrumbApClients = apClientCountSnapshot;
}

// ── Include Modules ──────────────────────────────────────────
// (Must come after globals since headers reference them as extern)
#include "dpa_wifi.h"  // WiFi AP+STA manager with NVS persistence
#include "led.h"       // FastLED strip (GPIO 5) + onboard LED (GPIO 21)
#include "sd_card.h"   // SD card via SPI (GP10-13)
#include "audio.h"     // I2S DAC playback via PCM5122 (GP6-8)
#include "intelligence.h" // Smart playlist, analytics, content protection
#include "captive.h"      // Captive portal DNS hijack (auto-open dashboard on WiFi connect)
#include "dpa_ingest.h"   // STA-mode private ingest uploader + NVS config
// #include "espnow_mesh.h"  // ESP-NOW — disabled until device gains traction
#include "api.h"       // REST API endpoint handlers
#include "dashboard.h" // PROGMEM gzipped HTML dashboard

// ── Web Servers ──────────────────────────────────────────────
AsyncWebServer server(80);      // Async: dashboard, API, captive portal
WebServer uploadServer(81);     // Sync: reliable large file uploads (matches DPAC uploader pattern)

// ── WiFi AP Config ───────────────────────────────────────────
const char* AP_PASSWORD = NULL;  // Open network — no password
const int   AP_CHANNEL  = 6;
const int   AP_MAX_CONN = 4;

static void restartPortalControlPlane(bool recycleAp, const char* reason) {
  const unsigned long nowMs = millis();
  g_lastPortalControlPlaneRestartAtMs = nowMs;
  g_portalHttpWatchdogArmed = false;
  Serial.printf("[HTTP] Restarting portal control plane (%s)%s\n",
    reason,
    recycleAp ? " with AP recycle" : "");

  g_httpReady = false;
  g_httpMode = "starting";
  g_wifiMaintenanceMode = recycleAp ? "ap-recovering" : "http-recovering";
  refreshRuntimeState();

  server.end();
  g_dnsServer.stop();
  delay(180);

  if (recycleAp) {
    WiFi.softAPdisconnect(false);
    delay(120);
    bool apOk = WiFi.softAP(g_apSSID.c_str(), AP_PASSWORD, AP_CHANNEL, 0, AP_MAX_CONN);
    WiFi.setSleep(false);
    esp_wifi_set_ps(WIFI_PS_NONE);
    Serial.printf("[WIFI] AP recycle %s for SSID %s\n", apOk ? "OK" : "FAILED", g_apSSID.c_str());
    delay(80);
  }

  captiveInit();
  delay(120);
  server.begin();

  g_httpReady = true;
  g_httpMode = "full";
  g_wifiMaintenanceMode = "normal";
  refreshRuntimeState();
  Serial.printf("[HTTP] Portal control plane ready (%s)\n", reason);
}

static void notePortalHttpActivity() {
  g_lastPortalHttpActivityAtMs = millis();
  g_portalHttpWatchdogArmed = true;
}

// ── DUID from NVS ────────────────────────────────────────────
void loadOrGenerateDUID() {
  Preferences prefs;
  prefs.begin("dpa_id", false);

  if (prefs.isKey("duid")) {
    g_duid = prefs.getString("duid", "DPA-AB12");
    Serial.println("[BOOT] DUID loaded: " + g_duid);
  } else {
    // Generate random DUID on first boot
    char buf[9];
    snprintf(buf, sizeof(buf), "DPA-%04X", (uint16_t)(esp_random() & 0xFFFF));
    g_duid = String(buf);
    prefs.putString("duid", g_duid);
    Serial.println("[BOOT] DUID generated: " + g_duid);
  }

  prefs.end();
}

// ── Scan all playable track paths into g_wavPaths[] ──────────
// Includes DPA1-wrapped WAV payloads first, then raw WAV legacy files.
// g_wavPaths[] naming is kept for compatibility with existing analytics/favorites code.
void scanWavList() {
  g_wavCount = 0;
  File dir = SD.open("/tracks");
  if (!dir || !dir.isDirectory()) { if (dir) dir.close(); return; }
  while (g_wavCount < 32) {
    File f = dir.openNextFile();
    if (!f) break;
    String name = String(f.name());
    if (name.endsWith(".dpa") || name.endsWith(".DPA") ||
        name.endsWith(".wav") || name.endsWith(".WAV")) {
      String fullPath = name.startsWith("/") ? name : ("/tracks/" + name);
      // Validate playable track header — skip corrupt/invalid assets.
      WavInfo info = audioParsePlayable(f, fullPath);
      if (info.valid) {
        g_wavPaths[g_wavCount++] = fullPath;
        Serial.printf("[SCAN] Track %d: %s [%s] (%luHz %u-bit)\n", g_wavCount, fullPath.c_str(),
                      info.format.c_str(), (unsigned long)info.sampleRate, info.bitsPerSample);
      } else {
        Serial.printf("[SCAN] SKIP invalid track: %s\n", fullPath.c_str());
      }
    }
    f.close();
  }
  dir.close();
  Serial.printf("[SCAN] Found %d valid playable files\n", g_wavCount);
  if (g_wavCount > 0) g_firstPlayableWav = g_wavPaths[0];
}

// ── Favorites: Load/Save to SD /data/favorites.txt ───────────
void loadFavorites() {
  g_favCount = 0;
  File f = SD.open("/data/favorites.txt", FILE_READ);
  if (!f) return;
  while (f.available() && g_favCount < 32) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (line.length() > 0) {
      g_favorites[g_favCount++] = line;
    }
  }
  f.close();
  Serial.printf("[FAV] Loaded %d favorites\n", g_favCount);
}

static bool g_favsDirty = false;

void saveFavorites() {
  // Defer if audio is playing to avoid SPI bus contention with core 1
  if (g_audioPlaying) {
    g_favsDirty = true;
    Serial.println("[FAV] Deferred save (audio playing)");
    return;
  }
  if (!SD.exists("/data")) SD.mkdir("/data");
  File f = SD.open("/data/favorites.txt", FILE_WRITE);
  if (!f) { Serial.println("[FAV] Failed to save"); return; }
  for (int i = 0; i < g_favCount; i++) {
    f.println(g_favorites[i]);
  }
  f.close();
  g_favsDirty = false;
  Serial.printf("[FAV] Saved %d favorites\n", g_favCount);
}

void favoritesFlushIfDirty() {
  if (g_favsDirty) saveFavorites();
}

bool isFavorite(const String& path) {
  for (int i = 0; i < g_favCount; i++) {
    if (g_favorites[i] == path) return true;
  }
  return false;
}

void toggleFavorite(const String& path) {
  // Find track index for analytics sync
  int trackIdx = -1;
  for (int i = 0; i < g_wavCount; i++) {
    if (g_wavPaths[i] == path) { trackIdx = i; break; }
  }

  // Check if already a favorite
  for (int i = 0; i < g_favCount; i++) {
    if (g_favorites[i] == path) {
      // Remove — shift array
      for (int j = i; j < g_favCount - 1; j++) {
        g_favorites[j] = g_favorites[j + 1];
      }
      g_favCount--;
      Serial.println("[FAV] Removed: " + path);
      saveFavorites();
      analyticsSyncFavorite(trackIdx, false);
      return;
    }
  }
  // Add
  if (g_favCount < 32) {
    g_favorites[g_favCount++] = path;
    Serial.println("[FAV] Added: " + path);
    saveFavorites();
    analyticsSyncFavorite(trackIdx, true);
  }
}

// ── Play Track by Index ──────────────────────────────────────
void playTrackByIndex(int idx) {
  if (idx < 0 || idx >= g_wavCount) return;

  // Close race window: if switching tracks, mark not-playing before stopping old track
  // This prevents loop() auto-advance from triggering during the switch
  if (g_audioPlaying) {
    g_playing = false;
  }

  g_trackIndex = idx;

  // Ensure SD is at fast speed for playback
  if (g_sdCurrentHz != SD_FAST_HZ) {
    sdMountFast();
  }

  if (audioPlayFile(g_wavPaths[idx].c_str())) {
    g_playing = true;
    g_playCount++;
    ledSetMode(LED_PLAYBACK);
    analyticsOnPlay(idx, audioGetDurationMs());
    Serial.printf("[PLAY] Track %d: %s\n", idx, g_wavPaths[idx].c_str());
  }
}

// ── Admin Mode Button Combo (HEART + NEXT held 3s) ───────────
static unsigned long g_adminComboStart = 0;
static bool g_adminComboActive = false;

void adminComboTick() {
  bool heartDown = (digitalRead(BTN_HEART_PIN) == LOW);
  bool nextDown  = (digitalRead(BTN_NEXT_PIN) == LOW);

  if (heartDown && nextDown) {
    if (!g_adminComboActive) {
      g_adminComboActive = true;
      g_adminComboStart = millis();
    } else if (millis() - g_adminComboStart >= 3000) {
      // 3 second hold — toggle admin mode
      g_adminMode = !g_adminMode;
      g_adminComboActive = false;
      g_adminComboStart = 0;
      if (g_adminMode) {
        ledNotify("#ffd700", "sparkle", 1000);  // Gold sparkle = admin unlocked
        Serial.println("[ADMIN] Mode UNLOCKED via button combo");
      } else {
        ledNotify("#444444", "fade_out", 500);   // Dim fade = admin locked
        Serial.println("[ADMIN] Mode LOCKED via button combo");
      }
    }
  } else {
    g_adminComboActive = false;
  }
}

// ── Hardware Button Handler (GP1-4 + BOOT) ───────────────────
struct BtnState {
  uint8_t pin;
  bool lastState;
  uint32_t lastDebounce;
  bool handled;
};

static BtnState g_buttons[] = {
  { BOOT_BTN_PIN, HIGH, 0, false },  // BOOT = same as play/pause
  { BTN_PLAY_PIN,  HIGH, 0, false },  // GP1 = play/pause
  { BTN_NEXT_PIN,  HIGH, 0, false },  // GP2 = next
  { BTN_PREV_PIN,  HIGH, 0, false },  // GP3 = prev
  { BTN_HEART_PIN, HIGH, 0, false },  // GP4 = heart
};
static const int NUM_BUTTONS = 5;

void buttonsTick() {
  for (int b = 0; b < NUM_BUTTONS; b++) {
    bool btn = digitalRead(g_buttons[b].pin);

    if (btn != g_buttons[b].lastState) {
      g_buttons[b].lastDebounce = millis();
      g_buttons[b].lastState = btn;
    }

    if ((millis() - g_buttons[b].lastDebounce) > 30) {
      if (btn == LOW && !g_buttons[b].handled) {
        g_buttons[b].handled = true;

        uint8_t pin = g_buttons[b].pin;

        if (g_uploadInProgress &&
            (pin == BOOT_BTN_PIN || pin == BTN_PLAY_PIN || pin == BTN_NEXT_PIN || pin == BTN_PREV_PIN)) {
          Serial.println("[BTN] Upload active — playback controls temporarily blocked");
          ledNotify("#ffaa33", "fade_out", 250);
          continue;
        }

        // ── PLAY/PAUSE (BOOT or GP1) ──
        if (pin == BOOT_BTN_PIN || pin == BTN_PLAY_PIN) {
          if (g_audioPlaying) {
            Serial.println("[BTN] Pause");
            g_playing = false;   // Set BEFORE audioStop to close race window
            g_pauseCount++;
            ledNotify("#ff6b35", "fade_out", 500);  // LED fires FIRST — instant feedback
            audioStop();  // Then stop audio (may block briefly)
          } else if (g_wavCount > 0) {
            Serial.printf("[BTN] Play track %d\n", g_trackIndex);
            ledNotify("#00ff88", "comet", 700);  // LED fires FIRST — instant feedback
            playTrackByIndex(g_trackIndex);
          } else {
            Serial.println("[BTN] No tracks");
          }
        }
        // ── NEXT (GP2) ──
        else if (pin == BTN_NEXT_PIN) {
          if (g_wavCount > 0) {
            int next = playlistNextTrack(g_trackIndex);
            Serial.printf("[BTN] Next -> %d\n", next);
            g_nextCount++;
            ledNotify("#4f46e5", "chase_fwd", 400);  // Indigo chase forward = next
            playTrackByIndex(next);
          }
        }
        // ── PREV (GP3) ──
        else if (pin == BTN_PREV_PIN) {
          if (g_wavCount > 0) {
            int prev = playlistPrevTrack(g_trackIndex);
            Serial.printf("[BTN] Prev -> %d\n", prev);
            g_prevCount++;
            ledNotify("#a855f7", "chase_rev", 400);  // Purple chase backward = prev
            playTrackByIndex(prev);
          }
        }
        // ── HEART (GP4) ──
        else if (pin == BTN_HEART_PIN) {
          if (g_trackIndex >= 0 && g_trackIndex < g_wavCount) {
            String path = g_wavPaths[g_trackIndex];
            bool wasLiked = isFavorite(path);
            toggleFavorite(path);
            // Red heart pulse on LED (700ms)
            ledNotify(wasLiked ? "#444444" : "#cc0040", "heartbeat", 700);
            Serial.printf("[BTN] Heart %s: %s\n", wasLiked ? "removed" : "added", path.c_str());
          } else {
            Serial.println("[BTN] Heart — no track selected");
          }
        }
      }

      if (btn == HIGH) {
        g_buttons[b].handled = false;
      }
    }
  }
}

// ── Synchronous Upload Server (port 81) ──────────────────────
// Mirrors the proven DPAC uploader pattern: synchronous WebServer,
// persistent file handle, adaptive staging buffer, 4-retry writes.
// ESPAsyncWebServer (port 80) has known bugs with large file uploads.

static File g_syncUploadFile;
static String g_syncFinalPath;
static String g_syncTempPath;
static size_t g_syncBytesWritten = 0;
static bool g_syncWriteError = false;
static bool g_syncCompleted = false;
static const size_t SYNC_STAGE_TARGET_SIZE = 32768;
static uint8_t* g_syncStageBuf = nullptr;
static size_t g_syncStageCapacity = 0;
static size_t g_syncStageUsed = 0;
static unsigned long g_syncUploadStartedAtMs = 0;
static String g_syncUploadMode = "safe";
static uint32_t g_syncUploadHz = SD_SLOW_HZ;

static bool ensureSyncStageBuffer() {
  if (g_syncStageBuf && g_syncStageCapacity > 0) return true;

  const size_t candidateSizes[] = { SYNC_STAGE_TARGET_SIZE, 16384, 8192 };
  for (size_t i = 0; i < (sizeof(candidateSizes) / sizeof(candidateSizes[0])); i++) {
    const size_t candidate = candidateSizes[i];

    g_syncStageBuf = (uint8_t*)heap_caps_malloc(candidate, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!g_syncStageBuf) {
      g_syncStageBuf = (uint8_t*)heap_caps_malloc(candidate, MALLOC_CAP_8BIT);
    }
    if (g_syncStageBuf) {
      g_syncStageCapacity = candidate;
      Serial.printf("[UPLOAD] Stage buffer ready: %u bytes\n", (unsigned)g_syncStageCapacity);
      return true;
    }
  }

  g_syncStageCapacity = 0;
  Serial.println("[UPLOAD] Stage buffer allocation failed");
  return false;
}

static bool selectSyncUploadSpeed(const String& speedArgRaw) {
  String speedArg = speedArgRaw;
  speedArg.trim();
  speedArg.toLowerCase();

  bool ok = false;
  String mode = "auto";

  if (speedArg.length() == 0 || speedArg == "auto" || speedArg == "turbo") {
    ok = sdMountUploadAuto();
    mode = "auto";
  } else if (speedArg == "safe" || speedArg == "slow") {
    ok = sdMountUploadSafe();
    mode = "safe";
  } else {
    char* endPtr = nullptr;
    unsigned long requestedHz = strtoul(speedArg.c_str(), &endPtr, 10);
    if (endPtr && *endPtr == '\0' && requestedHz >= SD_SLOW_HZ && requestedHz <= SD_FAST_HZ) {
      ok = sdRemount((uint32_t)requestedHz) && sdWriteProbeCurrentMount();
      mode = "manual";
    }
  }

  if (!ok && mode != "safe") {
    Serial.printf("[UPLOAD] Requested speed '%s' failed, falling back to safe mode\n", speedArgRaw.c_str());
    ok = sdMountUploadSafe();
    mode = "safe-fallback";
  }

  if (ok) {
    g_syncUploadMode = mode;
    g_syncUploadHz = g_sdCurrentHz;
    Serial.printf("[UPLOAD] Using %s upload path at %lu Hz\n",
      g_syncUploadMode.c_str(),
      (unsigned long)g_syncUploadHz);
  }
  return ok;
}

static bool syncFlushStage() {
  if (g_syncStageUsed == 0) return true;
  if (!g_syncUploadFile || !g_syncStageBuf || g_syncStageCapacity == 0) return false;
  size_t w = 0;
  int retries = 0;
  while (w < g_syncStageUsed && retries < 4) {
    size_t chunk = min(g_syncStageUsed - w, (size_t)16384);
    size_t wrote = g_syncUploadFile.write(g_syncStageBuf + w, chunk);
    if (wrote > 0) {
      w += wrote;
      retries = 0;
    } else {
      retries++;
      uint32_t backoffMs = 15U * retries * retries;
      Serial.printf("[UPLOAD] Stage flush retry %d after %ums\n", retries, (unsigned)backoffMs);
      delay(backoffMs);
    }
  }
  if (w == g_syncStageUsed) {
    g_syncBytesWritten += w;
    g_syncStageUsed = 0;
    return true;
  }
  return false;
}

static bool syncStageData(const uint8_t* data, size_t len) {
  if (!g_syncStageBuf || g_syncStageCapacity == 0) return false;
  size_t offset = 0;
  while (offset < len) {
    size_t space = g_syncStageCapacity - g_syncStageUsed;
    size_t toCopy = min(space, len - offset);
    memcpy(g_syncStageBuf + g_syncStageUsed, data + offset, toCopy);
    g_syncStageUsed += toCopy;
    offset += toCopy;
    if (g_syncStageUsed == g_syncStageCapacity) {
      if (!syncFlushStage()) return false;
    }
  }
  return true;
}

static void resetUploadWatchdogWindow() {
  // Upload mode intentionally suspends the normal dashboard traffic pattern, so
  // the portal inactivity watchdog should not treat the upload blackout as a
  // dead control plane.
  g_lastPortalHttpActivityAtMs = millis();
  g_portalHttpWatchdogArmed = false;
}

static void restoreAfterSyncUpload(bool refreshMediaIndex) {
  bool remountedFast = sdMountFast();
  if (!remountedFast) {
    Serial.println("[UPLOAD] Fast SD remount failed, falling back to slow mount");
    remountedFast = sdMountSlow();
  }
  g_sdState = remountedFast ? "mounted" : "error";
  sdRefreshStats();
  if (refreshMediaIndex) {
    scanWavList();
  }

  resetUploadWatchdogWindow();

  // Restart everything now that upload isolation is over.
  // Keep WiFi sleep OFF — re-enabling causes intermittent AP client drops.
  // wifiInit() already set WIFI_PS_NONE + setSleep(false) for AP stability.
  captiveInit();
  server.begin();
  g_httpMode = "full";
  g_httpReady = true;
  g_wifiMaintenanceMode = "normal";
  refreshRuntimeState();
  Serial.println("[HTTP] Async server + DNS restarted");
}

void handleSyncUploadDone() {
  String j;
  if (g_syncCompleted) {
    j = "{\"ok\":true,\"path\":\"" + escJson(g_syncFinalPath) + "\",\"bytes\":" + String((unsigned long)g_syncBytesWritten) + "}";
  } else {
    j = "{\"ok\":false,\"error\":\"upload failed\"}";
  }
  uploadServer.sendHeader("Access-Control-Allow-Origin", "*");
  uploadServer.send(200, "application/json", j);
  if (g_syncCompleted) {
    g_uploadState = "idle";
    refreshRuntimeState();
  }
}

void handleSyncFileUpload() {
  HTTPUpload& upload = uploadServer.upload();

  if (upload.status == UPLOAD_FILE_START) {
    if (g_audioPlaying) { audioStop(); delay(100); }
    WiFi.setSleep(false);
    g_uploadInProgress = true;
    g_uploadState = "preparing";
    g_wifiMaintenanceMode = "upload-lite";
    g_httpMode = "minimal";
    g_httpReady = true;
    resetUploadWatchdogWindow();
    g_syncUploadMode = "safe";
    g_syncUploadHz = SD_SLOW_HZ;
    g_syncUploadStartedAtMs = 0;
    refreshRuntimeState();

    // Stop EVERYTHING that touches the network/SPI to eliminate bus contention
    server.end();         // Stop async HTTP server
    g_dnsServer.stop();   // Stop captive DNS server
    delay(100);

    if (!ensureSyncStageBuffer()) {
      g_sdState = "error";
      g_uploadState = "error";
      refreshRuntimeState();
      Serial.println("[UPLOAD] Failed to allocate staging buffer");
    } else if (!selectSyncUploadSpeed(uploadServer.arg("speed"))) {
      g_sdState = "error";
      g_uploadState = "error";
      refreshRuntimeState();
      Serial.println("[UPLOAD] Failed to select a verified SD upload speed");
    } else {
      g_sdState = "mounted";
      refreshRuntimeState();
    }

    // Honor ?path= query param if provided (e.g. /art/cover.jpg for cover uploads);
    // otherwise fall back to legacy /tracks/<filename> behavior so the 24/96 + 32/96
    // audio upload flow stays bit-for-bit identical.
    String reqPath = uploadServer.arg("path");
    String safeName = sanitizePath(reqPath.length() > 0 ? reqPath : (String("/tracks/") + String(upload.filename)));
    // Ensure parent directory exists (e.g. create /art if writing /art/cover.jpg).
    // No-op for repeat /tracks/* audio uploads.
    {
      int _slash = safeName.lastIndexOf('/');
      if (_slash > 0) {
        String _dir = safeName.substring(0, _slash);
        if (_dir.length() > 0 && !SD.exists(_dir)) SD.mkdir(_dir);
      }
    }
    g_syncFinalPath = safeName;
    g_syncTempPath = safeName + ".part";
    g_lastUploadPath = safeName;
    g_lastUploadBytes = 0;

    if (SD.exists(g_syncTempPath)) SD.remove(g_syncTempPath);
    if (SD.exists(g_syncFinalPath)) SD.remove(g_syncFinalPath);

    g_syncUploadFile = SD.open(g_syncTempPath, FILE_WRITE);
    g_syncBytesWritten = 0;
    g_syncWriteError = false;
    g_syncCompleted = false;
    g_syncStageUsed = 0;
    g_syncUploadStartedAtMs = millis();

    if (!g_syncUploadFile) {
      g_syncWriteError = true;
      Serial.printf("[UPLOAD] OPEN FAILED: %s\n", g_syncTempPath.c_str());
    } else {
      Serial.printf("[UPLOAD] Start: %s (%s) mode=%s sd=%luHz stage=%u\n",
        g_syncFinalPath.c_str(),
        upload.filename.c_str(),
        g_syncUploadMode.c_str(),
        (unsigned long)g_syncUploadHz,
        (unsigned)g_syncStageCapacity);
    }
  }
  else if (upload.status == UPLOAD_FILE_WRITE) {
    if (g_syncUploadFile && !g_syncWriteError) {
      if (g_uploadState != "receiving") {
        g_uploadState = "receiving";
        refreshRuntimeState();
      }
      if (!syncStageData(upload.buf, upload.currentSize)) {
        g_syncWriteError = true;
        g_uploadState = "error";
        refreshRuntimeState();
        Serial.printf("[UPLOAD] WRITE FAILED at %u bytes\n", (unsigned)g_syncBytesWritten);
      }
      if ((g_syncBytesWritten + g_syncStageUsed) % 524288 < upload.currentSize) {
        Serial.printf("[UPLOAD] Progress: %u bytes\n", (unsigned)(g_syncBytesWritten + g_syncStageUsed));
      }
    }
  }
  else if (upload.status == UPLOAD_FILE_END) {
    g_uploadState = "verifying";
    refreshRuntimeState();
    if (g_syncUploadFile && !g_syncWriteError) {
      if (!syncFlushStage()) g_syncWriteError = true;
    }
    if (g_syncUploadFile) {
      g_syncUploadFile.flush();
      g_syncUploadFile.close();
    }

    bool renamed = false;
    if (!g_syncWriteError && g_syncBytesWritten > 0) {
      g_uploadState = "finalizing";
      refreshRuntimeState();
      if (SD.exists(g_syncFinalPath)) SD.remove(g_syncFinalPath);
      renamed = SD.rename(g_syncTempPath, g_syncFinalPath);
      if (renamed) {
        File verify = SD.open(g_syncFinalPath, FILE_READ);
        if (!verify) {
          renamed = false;
        } else {
          size_t finalBytes = verify.size();
          verify.close();
          if (finalBytes != g_syncBytesWritten) {
            Serial.printf("[UPLOAD] VERIFY FAILED: expected=%u actual=%u\n",
              (unsigned)g_syncBytesWritten, (unsigned)finalBytes);
            SD.remove(g_syncFinalPath);
            renamed = false;
          }
        }
      }
    }
    if (!renamed && SD.exists(g_syncTempPath)) SD.remove(g_syncTempPath);

    g_syncCompleted = renamed;
    g_uploadInProgress = false;
    g_lastUploadBytes = g_syncBytesWritten;
    g_lastUploadMode = g_syncUploadMode;
    g_lastUploadSdHz = g_syncUploadHz;
    g_lastUploadDurationMs = g_syncUploadStartedAtMs > 0 ? (millis() - g_syncUploadStartedAtMs) : 0;
    g_lastUploadRateKBps = g_lastUploadDurationMs > 0
      ? (uint32_t)(((uint64_t)g_syncBytesWritten * 1000ULL) / 1024ULL / g_lastUploadDurationMs)
      : 0;

    g_uploadState = renamed ? "complete" : "error";
    restoreAfterSyncUpload(true);

    Serial.printf("[UPLOAD] End: wrote=%u renamed=%s path=%s\n",
      (unsigned)g_syncBytesWritten, renamed ? "YES" : "NO", g_syncFinalPath.c_str());
    Serial.printf("[UPLOAD] Stats: mode=%s sd=%luHz duration=%lums avg=%luKB/s\n",
      g_lastUploadMode.c_str(),
      (unsigned long)g_lastUploadSdHz,
      (unsigned long)g_lastUploadDurationMs,
      (unsigned long)g_lastUploadRateKBps);
  }
  else if (upload.status == UPLOAD_FILE_ABORTED) {
    if (g_syncUploadFile) {
      g_syncUploadFile.close();
    }
    if (g_syncTempPath.length() && SD.exists(g_syncTempPath)) SD.remove(g_syncTempPath);
    g_uploadInProgress = false;
    g_syncWriteError = true;
    g_syncCompleted = false;
    g_syncStageUsed = 0;
    g_syncBytesWritten = 0;
    g_syncUploadStartedAtMs = 0;
    g_uploadState = "idle";
    g_lastUploadMode = "aborted";
    g_lastUploadBytes = 0;
    g_lastUploadRateKBps = 0;
    g_lastUploadDurationMs = 0;
    g_lastUploadSdHz = 0;
    restoreAfterSyncUpload(true);
    Serial.println("[UPLOAD] Aborted");
  }
}

void handleSyncOptions() {
  uploadServer.sendHeader("Access-Control-Allow-Origin", "*");
  uploadServer.sendHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  uploadServer.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  uploadServer.send(204);
}

void setupSyncUploadServer() {
  uploadServer.on("/api/status", HTTP_GET, []() {
    notePortalHttpActivity();
    uploadServer.sendHeader("Access-Control-Allow-Origin", "*");
    uploadServer.sendHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    uploadServer.sendHeader("Pragma", "no-cache");
    uploadServer.sendHeader("Connection", "close");
    uploadServer.send(200, "application/json", buildStatusJson());
  });
  uploadServer.on("/api/status", HTTP_OPTIONS, handleSyncOptions);
  uploadServer.on("/api/sd/upload", HTTP_POST, handleSyncUploadDone, handleSyncFileUpload);
  uploadServer.on("/api/sd/upload", HTTP_OPTIONS, handleSyncOptions);
  uploadServer.begin();
  Serial.println("[HTTP] Upload server started on port 81");
}

// ── Setup ────────────────────────────────────────────────────
void setup() {
  // Force LED data pins LOW immediately to prevent stray pixels during boot
  pinMode(5, OUTPUT);
  digitalWrite(5, LOW);
  pinMode(21, OUTPUT);
  digitalWrite(21, LOW);
  delay(1);

  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("========================================");
  Serial.println("  DPA Portal -- Firmware v2.4.1");
  Serial.println("========================================");
  if (psramFound()) {
    Serial.printf("[BOOT] PSRAM detected: total=%u free=%u\n", ESP.getPsramSize(), ESP.getFreePsram());
  } else {
    Serial.println("[BOOT] PSRAM not detected");
  }

  // 0. Button pins init (all INPUT_PULLUP, active LOW)
  pinMode(BOOT_BTN_PIN, INPUT_PULLUP);
  pinMode(BTN_PLAY_PIN,  INPUT_PULLUP);
  pinMode(BTN_NEXT_PIN,  INPUT_PULLUP);
  pinMode(BTN_PREV_PIN,  INPUT_PULLUP);
  pinMode(BTN_HEART_PIN, INPUT_PULLUP);

  // 1. Load device identity from NVS
  loadOrGenerateDUID();

  // 2. Load LED theme from NVS (before ledInit so colors are ready)
  ledLoadFromNVS();

  // 3. Initialize LED strip (external GPIO 5 + onboard GPIO 21)
  ledInit();
  Serial.printf("[BOOT] LED strip: %d LEDs on GPIO %d\n", NUM_LEDS, LED_PIN);
  Serial.printf("[BOOT] Onboard LED on GPIO %d\n", ONBOARD_LED_PIN);

  // 4. Init SD card (SPI: CS=GP10, MOSI=GP11, CLK=GP12, MISO=GP13)
  g_sdState = "mounting";
  refreshRuntimeState();
  if (sdInit()) {
    g_sdState = "mounted";
    Serial.printf("[BOOT] SD card: %.0f MB total, %d files\n", g_sdTotalMB, g_sdFileCount);

    // Remount at fast speed for playback
    if (sdMountFast()) {
      Serial.println("[BOOT] SD remounted at 20MHz for playback");
      g_sdState = "mounted";
    } else {
      Serial.println("[BOOT] Fast SD remount failed, keeping slow mount");
      if (sdMountSlow()) {
        g_sdState = "mounted";
      } else {
        g_sdState = "error";
      }
    }

    // Scan all WAVs into track list
    scanWavList();
    if (g_wavCount > 0) {
      Serial.printf("[BOOT] %d tracks found, first: %s\n", g_wavCount, g_firstPlayableWav.c_str());
    } else {
      Serial.println("[BOOT] No valid WAV files in /tracks");
    }

    // Load favorites from SD
    loadFavorites();

    // Cover + per-track artwork folder (portal uploads to /art/)
    if (!SD.exists("/art")) {
      if (SD.mkdir("/art")) {
        Serial.println("[SD] Created /art");
      }
    }

    // Init on-device intelligence (analytics + capsules)
    analyticsInit();
    capsulesLoad();
    capsuleOtaLoadIndex();
    capsuleOtaCleanupStaleParts();
  } else {
    g_sdState = "error";
    Serial.println("[BOOT] SD card not available (continuing without storage)");
  }
  refreshRuntimeState();

  // 5. Init audio engine (I2S created per-file, just marks ready)
  if (audioInit()) {
    g_audioHardwareVerified = true;
    Serial.println("[BOOT] Audio DAC ready (PCM5122 via I2S, ws_inv=true)");
  } else {
    g_audioHardwareVerified = false;
    Serial.println("[BOOT] Audio DAC not available (continuing without audio)");
  }
  refreshRuntimeState();

  // 5b. Init battery ADC (GP9 + GP14 charge detect)
  batteryInit();
  if (g_battPresent) {
    Serial.printf("[BOOT] Battery: %.2fV (%d%%)\n", g_battVoltage, g_battPercent);
  } else {
    Serial.println("[BOOT] No battery detected — USB powered");
  }

  // 5c. Load private ingest config before network services start
  ingestLoadFromNVS();

  // 6. Start WiFi (AP always on + STA if credentials stored)
  wifiInit(AP_PASSWORD, AP_CHANNEL, AP_MAX_CONN);
  g_wifiReady = true;
  refreshRuntimeState();
  // WiFi.setSleep(false) is set only during uploads to avoid power rail noise on DAC line-out

  // 6b. Captive portal (DNS hijack — phones auto-open dashboard on WiFi connect)
  captiveInit();
  captiveRegisterProbes(server);
  Serial.println("[BOOT] Captive portal active (DNS hijack → 192.168.4.1)");

  // 6c. ESP-NOW mesh — disabled until device gains traction
  // espnowInit();
  Serial.println("[BOOT] ESP-NOW mesh: disabled (not compiled)");

  // 7. Serve dashboard (gzipped HTML from PROGMEM)
  auto& dashboardHandler = server.on("/", HTTP_GET, [](AsyncWebServerRequest* req) {
    notePortalHttpActivity();
    if (apiRejectHeavyRequest(req, "dashboard")) return;

    const String etag = "\"" + g_fwVersion + "\"";
    if (req->hasHeader("If-None-Match") && req->header("If-None-Match") == etag) {
      AsyncWebServerResponse* response = req->beginResponse(304);
      response->addHeader("Cache-Control", "no-cache, must-revalidate");
      response->addHeader("ETag", etag);
      response->addHeader("Connection", "close");
      req->send(response);
      return;
    }

    AsyncWebServerResponse* response = req->beginResponse(
      200, "text/html", DASHBOARD_HTML_GZ, DASHBOARD_HTML_GZ_LEN
    );
    response->addHeader("Content-Encoding", "gzip");
    response->addHeader("Cache-Control", "no-cache, must-revalidate");
    response->addHeader("ETag", etag);
    response->addHeader("Connection", "close");
    req->send(response);
  });
  attachChurnGuards(dashboardHandler, 2, 4, false);

  // 9. Register API routes (all /api/* endpoints)
  registerApiRoutes(server);

  // 10. CORS headers + Connection: close (free sockets faster on ESP32)
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "Content-Type");
  DefaultHeaders::Instance().addHeader("Connection", "close");

  // 11. Catch-all: handle captive portal probes + OPTIONS preflight + 404
  server.onNotFound([](AsyncWebServerRequest* req) {
    // CORS preflight for browser cross-origin POSTs (upload-raw, theme, capsule, etc.)
    if (req->method() == HTTP_OPTIONS) {
      req->send(204);
      return;
    }
    String host = req->host();
    String url = req->url();
    // iOS/macOS captive portal probes from foreign hosts
    if (url == "/hotspot-detect.html" || url == "/library/test/success.html") {
      req->send(200, "text/html",
        "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>");
      return;
    }
    // Android probes from foreign hosts
    if (url == "/generate_204" || url == "/gen_204") {
      req->send(204);
      return;
    }
    // Windows probes
    if (url == "/connecttest.txt") {
      req->send(200, "text/plain", "Microsoft Connect Test");
      return;
    }
    if (url == "/ncsi.txt") {
      req->send(200, "text/plain", "Microsoft NCSI");
      return;
    }
    // Any foreign host → redirect to dashboard
    if (host.length() > 0 && host != "192.168.4.1" && host != WiFi.softAPIP().toString()) {
      req->redirect("http://192.168.4.1/");
      return;
    }
    req->send(404, "text/plain", "Not Found");
  });

  // 12. Start web servers
  server.begin();
  Serial.println("[HTTP] Server started on port 80");

  // 12b. Start synchronous upload server (port 81) — reliable for large files
  setupSyncUploadServer();
  g_httpReady = true;
  g_httpMode = "full";
  refreshRuntimeState();

  // 13. Record boot time for uptime calculation
  g_bootTime = millis();

  // 14. Summary
  Serial.println();
  Serial.printf("[BOOT] Free heap at boot: %u bytes\n", ESP.getFreeHeap());
  Serial.println("[BOOT] State: " + g_bootState + " | Firmware v" + g_fwVersion);
  Serial.println("[BOOT] AP dashboard: http://192.168.4.1");
  if (g_staConnected) {
    Serial.println("[BOOT] Portal access: http://" + g_staIP);
  }
  Serial.printf("[BOOT] LED: %d external + onboard on GP%d/GP%d\n", NUM_LEDS, LED_PIN, ONBOARD_LED_PIN);
  Serial.printf("[BOOT] SD card: %s", g_sdMounted ? "mounted" : "not detected");
  if (g_sdMounted) Serial.printf(" (%.0fMB, %dMHz)", g_sdTotalMB, (int)(g_sdCurrentHz / 1000000));
  Serial.println();
  Serial.printf("[BOOT] Audio DAC: %s\n", g_audioReady ? "ready (ws_inv=true)" : "not detected");
  Serial.printf("[BOOT] Runtime: sd=%s upload=%s http=%s degradedReason=%s\n",
    g_sdState.c_str(),
    g_uploadState.c_str(),
    g_httpMode.c_str(),
    g_degradedReason.length() ? g_degradedReason.c_str() : "none");
  Serial.printf("[BOOT] Buttons: BOOT+GP1=play/pause, GP2=next, GP3=prev, GP4=heart\n");
  Serial.printf("[BOOT] Admin mode: HEART+NEXT 3s hold, or GET /api/admin/unlock?key=<DUID>\n");
  Serial.printf("[BOOT] Tracks: %d | Favorites: %d\n", g_wavCount, g_favCount);
  if (g_firstPlayableWav.length() > 0) {
    Serial.println("[BOOT] Press PLAY to start: " + g_firstPlayableWav);
  }
  Serial.println();
}

// ── Loop ─────────────────────────────────────────────────────
void loop() {
  // Handle synchronous upload server (port 81) — must run in loop
  uploadServer.handleClient();

  // During uploads: keep a minimal maintenance/status plane alive without
  // reintroducing the heavier background work that causes contention.
  if (g_uploadInProgress) {
    adminComboTick();
    buttonsTick();

    static unsigned long lastUploadWifiCheck = 0;
    if (millis() - lastUploadWifiCheck > 2000) {
      wifiTick();
      lastUploadWifiCheck = millis();
    }

    static unsigned long lastUploadBattRead = 0;
    if (millis() - lastUploadBattRead > BATT_READ_INTERVAL) {
      batteryRead();
      lastUploadBattRead = millis();
    }

    delay(1);
    return;
  }

  // Run LED animation engine (non-blocking, millis-based)
  ledTick();

  // Handle test tone playback (normal WAV playback runs in FreeRTOS task)
  audioTick();

  // Handle hardware buttons (GP0=boot, GP1=play/pause, GP2=next, GP3=prev, GP4=heart)
  buttonsTick();

  // Admin button combo (HEART + NEXT held 3s)
  adminComboTick();

  // Detect when audio task finishes
  if (!g_audioPlaying && g_playing) {
    // Audio task finished — but WHY?
    // g_audioStopRequested = user/API pressed stop → do NOT advance
    // g_audioStopRequested = false → track ended naturally → advance
    g_playing = false;
    if (!g_audioStopRequested && g_wavCount > 1) {
      // Natural end of track — auto-advance using smart playlist
      analyticsOnComplete(g_trackIndex);
      // Flush analytics NOW before starting next track
      // (otherwise g_audioPlaying goes true again and the flush is skipped)
      analyticsFlushIfDirty();
      int next = playlistNextTrack(g_trackIndex);
      Serial.printf("[AUTO] Next track -> %d\n", next);
      playTrackByIndex(next);
    } else {
      // User stopped playback — stay idle
      analyticsOnStop(g_trackIndex);
      analyticsFlushIfDirty();
      g_audioStopRequested = false;  // reset for next play
      Serial.println("[STOP] Playback stopped by user");
    }
  }

  // Flush deferred saves when not playing and not uploading (safe: no SPI contention)
  if (!g_audioPlaying && !g_uploadInProgress) {
    analyticsFlushIfDirty();
    favoritesFlushIfDirty();
  }

  // Skip all background SPI-touching tasks during upload (prevents SD bus contention)
  if (!g_uploadInProgress) {
    // Run WiFi scan if requested by API — skip during playback (blocks SPI)
    if (!g_audioPlaying) {
      wifiDoScan();
    }

    // Keep captive DNS responsive, but avoid servicing it every loop while audio
    // is active to reduce tiny background CPU bursts during playback.
    static unsigned long lastCaptiveTick = 0;
    const unsigned long captiveTickIntervalMs = g_audioPlaying ? 20UL : 0UL;
    if (captiveTickIntervalMs == 0 || (millis() - lastCaptiveTick) >= captiveTickIntervalMs) {
      captiveTick();
      lastCaptiveTick = millis();
    }

    // Monitor STA/AP maintenance even during playback. This is lightweight
    // event handling + RSSI refresh and prevents long-session radio drift.
    static unsigned long lastWifiCheck = 0;
    const unsigned long wifiCheckIntervalMs = g_audioPlaying ? 15000UL : 5000UL;
    if (millis() - lastWifiCheck > wifiCheckIntervalMs) {
      wifiTick();
      lastWifiCheck = millis();
    }

    if (g_apRecoveryPending) {
      int clients = wifiGetApStationCount();
      if (clients > 0) {
        g_apRecoveryPending = false;
        g_apRecoveryRequestedAtMs = 0;
        Serial.println("[WIFI] AP recovery cancelled: client rejoined before recycle");
      } else if (millis() - g_apRecoveryRequestedAtMs > 1500) {
        g_apRecoveryPending = false;
        g_apRecoveryRequestedAtMs = 0;
        g_httpRestartCount++;
        restartPortalControlPlane(true, "last_ap_client_left");
      }
    }

    // Keep OTA polling off the hot playback path for now. The install/download
    // phase will add a fuller state machine once check-in is validated.
    if (!g_audioPlaying) {
      capsuleOtaTick();
    }
  }

  // Periodic battery read (every 10s)
  static unsigned long lastBattRead = 0;
  const unsigned long battReadIntervalMs = g_audioPlaying ? (BATT_READ_INTERVAL * 3UL) : BATT_READ_INTERVAL;
  if (millis() - lastBattRead > battReadIntervalMs) {
    batteryRead();
    lastBattRead = millis();
  }

  // Heap watchdog — if free heap drops below 40KB, AsyncWebServer likely
  // has stale sockets piling up. Restart it to reclaim them. This prevents
  // the "portal stays connected but device stops responding" syndrome.
  static unsigned long lastHeapCheck = 0;
  if (millis() - lastHeapCheck > 10000) {
    lastHeapCheck = millis();
    const uint32_t freeHeap = controlPlaneFreeHeapBytes();
    const uint32_t largestHeapBlock = controlPlaneLargestHeapBlockBytes();
    const uint32_t internalFreeHeap = controlPlaneInternalFreeHeapBytes();
    const uint32_t internalLargestHeapBlock = controlPlaneInternalLargestHeapBlockBytes();
    const bool restartCoolingDown = (millis() - g_lastPortalControlPlaneRestartAtMs) < 15000UL;
    const bool lowControlPlaneHeap = apiHeavyRouteUnderPressure();
    const bool enoughHeapForRecovery =
      internalFreeHeap >= kControlPlaneRecoveryInternalFreeMinBytes &&
      internalLargestHeapBlock >= kControlPlaneRecoveryInternalLargestBlockMinBytes;
    const bool safeDuringPlayback =
      !g_audioPlaying || internalLargestHeapBlock >= kControlPlanePlaybackSafeInternalLargestBlockMinBytes;
    if (lowControlPlaneHeap && !restartCoolingDown && enoughHeapForRecovery && safeDuringPlayback) {
      Serial.printf(
        "[HEAP] Control-plane heap low: total=%u/%u internal=%u/%u — restarting async server\n",
        freeHeap,
        largestHeapBlock,
        internalFreeHeap,
        internalLargestHeapBlock
      );
      g_httpRestartCount++;
      noteDisconnectBreadcrumb(
        "restart",
        "http",
        "low_memory_watchdog",
        "Async HTTP server restarted after the low-heap watchdog tripped.",
        0,
        g_staRSSI,
        wifiGetApStationCount(),
        freeHeap,
        largestHeapBlock
      );
      g_httpReady = false;
      restartPortalControlPlane(false, "low_memory_watchdog");
      Serial.printf("[HEAP] Server restarted, heap now: %u\n", ESP.getFreeHeap());
    } else if (lowControlPlaneHeap && !restartCoolingDown && (!enoughHeapForRecovery || !safeDuringPlayback)) {
      Serial.printf(
        "[HEAP] Control-plane heap low: total=%u/%u internal=%u/%u — restart deferred until recovery is safer\n",
        freeHeap,
        largestHeapBlock,
        internalFreeHeap,
        internalLargestHeapBlock
      );
    } else if (lowControlPlaneHeap && restartCoolingDown) {
      Serial.printf(
        "[HEAP] Control-plane heap low: total=%u/%u internal=%u/%u — restart suppressed (cooldown active)\n",
        freeHeap,
        largestHeapBlock,
        internalFreeHeap,
        internalLargestHeapBlock
      );
    }
  }

  // Portal liveness watchdog — if a browser was actively polling status and
  // the DPA still has associated AP clients, but status traffic suddenly stops,
  // treat that as a dead control plane and recycle it proactively.
  static unsigned long lastPortalWatchdogCheck = 0;
  if (millis() - lastPortalWatchdogCheck > 4000) {
    lastPortalWatchdogCheck = millis();
    const int apClients = wifiGetApStationCount();
    const bool activeClientSession = apClients > 0 && g_portalHttpWatchdogArmed && g_lastPortalHttpActivityAtMs > 0;
    const unsigned long silentForMs = activeClientSession ? (millis() - g_lastPortalHttpActivityAtMs) : 0;
    const uint32_t freeHeap = controlPlaneFreeHeapBytes();
    const uint32_t largestHeapBlock = controlPlaneLargestHeapBlockBytes();
    const uint32_t internalFreeHeap = controlPlaneInternalFreeHeapBytes();
    const uint32_t internalLargestHeapBlock = controlPlaneInternalLargestHeapBlockBytes();
    const bool restartCoolingDown = (millis() - g_lastPortalControlPlaneRestartAtMs) < 15000UL;
    const bool enoughHeapForRecovery =
      internalFreeHeap >= kControlPlaneRecoveryInternalFreeMinBytes &&
      internalLargestHeapBlock >= kControlPlaneRecoveryInternalLargestBlockMinBytes;
    if (!g_uploadInProgress && activeClientSession && silentForMs > kPortalHttpSilenceRestartMs && enoughHeapForRecovery && !restartCoolingDown) {
      g_httpRestartCount++;
      noteDisconnectBreadcrumb(
        "restart",
        "http",
        "portal_inactivity_watchdog",
        "Portal status traffic stopped while AP clients were still associated, so the control plane was recycled.",
        0,
        g_staRSSI,
        apClients,
        freeHeap,
        largestHeapBlock
      );
      g_portalHttpWatchdogArmed = false;
      restartPortalControlPlane(false, "portal_inactivity_watchdog");
    } else if (!g_uploadInProgress && activeClientSession && silentForMs > kPortalHttpSilenceRestartMs && !enoughHeapForRecovery) {
      Serial.printf("[HTTP] Portal inactivity watchdog suppressed: silent=%lu total=%u/%u internal=%u/%u apClients=%d\n",
        silentForMs,
        freeHeap,
        largestHeapBlock,
        internalFreeHeap,
        internalLargestHeapBlock,
        apClients);
    }
  }

  // Small yield to prevent WDT reset
  delay(5);
}
