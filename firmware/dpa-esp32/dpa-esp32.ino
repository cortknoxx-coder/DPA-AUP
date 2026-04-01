/*
 * DPA ESP32-S3 Dashboard Firmware — Phase 2
 * ──────────────────────────────────────────
 * Hardware: Waveshare ESP32-S3 Zero (8MB flash, no PSRAM)
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
 *   Board:            ESP32S3 Dev Module
 *   Flash Size:       8MB
 *   Partition Scheme: Default 4MB with spiffs (or 8M with spiffs)
 *   PSRAM:            Disabled
 *   USB CDC On Boot:  Enabled
 *
 * Version: 2.3.0
 * Updated: 2026-04-01
 */

#include <WiFi.h>
#include <Preferences.h>

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
String g_fwVersion  = "2.3.0";

// Admin mode (consumer-only by default, unlocked via button combo or API)
bool   g_adminMode  = false;

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
String g_ledIdle      = "#ff4bcb";
String g_ledIdlePat   = "breathing";
String g_ledPlay      = "#00f1df";
String g_ledPlayPat   = "comet";
String g_ledCharge    = "#ffcc33";
String g_ledChargePat = "breathing";
int    g_brightness   = 80;

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

// Battery (real ADC on BATT_ADC_PIN, or USB-powered if no divider wired)
float  g_battVoltage = 0;
int    g_battPercent = -1;   // -1 = no battery detected (USB powered)
bool   g_charging    = false;
bool   g_battPresent = false; // true if voltage divider is wired

// ── Battery ADC Reading ─────────────────────────────────────
void batteryInit() {
  analogReadResolution(12);           // 0-4095
  analogSetAttenuation(ADC_11db);     // Full 0-3.3V range (ADC_ATTEN_DB_11 on Core 3.x)
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

// ── Include Modules ──────────────────────────────────────────
// (Must come after globals since headers reference them as extern)
#include "dpa_wifi.h"  // WiFi AP+STA manager with NVS persistence
#include "led.h"       // FastLED strip (GPIO 5) + onboard LED (GPIO 21)
#include "sd_card.h"   // SD card via SPI (GP10-13)
#include "audio.h"     // I2S DAC playback via PCM5122 (GP6-8)
#include "captive.h"   // Captive portal DNS hijack + probe redirects
#include "intelligence.h" // Smart playlist, analytics, content protection
#include "espnow_mesh.h"  // ESP-NOW device mesh (broadcast, peer tracking)
#include "api.h"       // REST API endpoint handlers
#include "dashboard.h" // PROGMEM gzipped HTML dashboard

// ── Web Server ───────────────────────────────────────────────
AsyncWebServer server(80);

// ── WiFi AP Config ───────────────────────────────────────────
const char* AP_PASSWORD = "dpa12345";
const int   AP_CHANNEL  = 6;
const int   AP_MAX_CONN = 4;

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

// ── Scan all WAV paths into g_wavPaths[] ─────────────────────
void scanWavList() {
  g_wavCount = 0;
  File dir = SD.open("/tracks");
  if (!dir || !dir.isDirectory()) { if (dir) dir.close(); return; }
  while (g_wavCount < 32) {
    File f = dir.openNextFile();
    if (!f) break;
    String name = String(f.name());
    if (name.endsWith(".wav") || name.endsWith(".WAV")) {
      String fullPath = name.startsWith("/") ? name : ("/tracks/" + name);
      g_wavPaths[g_wavCount++] = fullPath;
      Serial.printf("[SCAN] Track %d: %s\n", g_wavCount, fullPath.c_str());
    }
    f.close();
  }
  dir.close();
  Serial.printf("[SCAN] Found %d WAV files\n", g_wavCount);
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

void saveFavorites() {
  if (!SD.exists("/data")) SD.mkdir("/data");
  File f = SD.open("/data/favorites.txt", FILE_WRITE);
  if (!f) { Serial.println("[FAV] Failed to save"); return; }
  for (int i = 0; i < g_favCount; i++) {
    f.println(g_favorites[i]);
  }
  f.close();
  Serial.printf("[FAV] Saved %d favorites\n", g_favCount);
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
    meshSendPlaySync(0x01, idx);  // Broadcast play to mesh followers
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

    if ((millis() - g_buttons[b].lastDebounce) > 50) {
      if (btn == LOW && !g_buttons[b].handled) {
        g_buttons[b].handled = true;

        uint8_t pin = g_buttons[b].pin;

        // ── PLAY/PAUSE (BOOT or GP1) ──
        if (pin == BOOT_BTN_PIN || pin == BTN_PLAY_PIN) {
          if (g_audioPlaying) {
            Serial.println("[BTN] Pause");
            g_playing = false;   // Set BEFORE audioStop to close race window
            audioStop();
            g_pauseCount++;
            ledNotify("#ff6b35", "fade_out", 500);  // Warm orange fade = stop
          } else if (g_wavCount > 0) {
            Serial.printf("[BTN] Play track %d\n", g_trackIndex);
            ledNotify("#00ff88", "comet", 700);  // Green comet spin = play
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
          if (g_audioPlaying && g_trackIndex >= 0 && g_trackIndex < g_wavCount) {
            String path = g_wavPaths[g_trackIndex];
            bool wasLiked = isFavorite(path);
            toggleFavorite(path);
            // Red heart pulse on LED (500ms)
            ledNotify(wasLiked ? "#444444" : "#ff1744", "heartbeat", 700);
            Serial.printf("[BTN] Heart %s: %s\n", wasLiked ? "removed" : "added", path.c_str());
          } else {
            Serial.println("[BTN] Heart — nothing playing");
          }
        }
      }

      if (btn == HIGH) {
        g_buttons[b].handled = false;
      }
    }
  }
}

// ── Setup ────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("========================================");
  Serial.println("  DPA Portal -- Firmware v2.3.0");
  Serial.println("========================================");

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
  if (sdInit()) {
    Serial.printf("[BOOT] SD card: %.0f MB total, %d files\n", g_sdTotalMB, g_sdFileCount);

    // Remount at fast speed for playback
    if (sdMountFast()) {
      Serial.println("[BOOT] SD remounted at 20MHz for playback");
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

    // Init on-device intelligence (analytics + smart playlist)
    analyticsInit();
    playlistBuild();
  } else {
    Serial.println("[BOOT] SD card not available (continuing without storage)");
  }

  // 5. Init audio engine (I2S created per-file, just marks ready)
  if (audioInit()) {
    Serial.println("[BOOT] Audio DAC ready (PCM5122 via I2S, ws_inv=true)");
  } else {
    Serial.println("[BOOT] Audio DAC not available (continuing without audio)");
  }

  // 5b. Init battery ADC (GP9 + GP14 charge detect)
  batteryInit();
  if (g_battPresent) {
    Serial.printf("[BOOT] Battery: %.2fV (%d%%)\n", g_battVoltage, g_battPercent);
  } else {
    Serial.println("[BOOT] No battery detected — USB powered");
  }

  // 6. Start WiFi (AP always on + STA if credentials stored)
  wifiInit(AP_PASSWORD, AP_CHANNEL, AP_MAX_CONN);

  // 6b. Start captive portal (DNS hijack → auto-open dashboard on phone)
  captiveInit();

  // 6c. Start ESP-NOW mesh (if enabled in NVS)
  espnowInit();

  // 7. Register captive portal probe redirects (before server.begin)
  captiveRegisterProbes(server);

  // 8. Serve dashboard (gzipped HTML from PROGMEM)
  server.on("/", HTTP_GET, [](AsyncWebServerRequest* req) {
    AsyncWebServerResponse* response = req->beginResponse_P(
      200, "text/html", DASHBOARD_HTML_GZ, DASHBOARD_HTML_GZ_LEN
    );
    response->addHeader("Content-Encoding", "gzip");
    response->addHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    response->addHeader("Pragma", "no-cache");
    response->addHeader("Expires", "0");
    req->send(response);
  });

  // 9. Register API routes (all /api/* endpoints)
  registerApiRoutes(server);

  // 10. CORS headers for development
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "Content-Type");

  // 11. Start web server
  server.begin();
  Serial.println("[HTTP] Server started on port 80");

  // 12. Record boot time for uptime calculation
  g_bootTime = millis();

  // 13. Summary
  Serial.println();
  Serial.println("[BOOT] Ready! Firmware v" + g_fwVersion);
  Serial.println("[BOOT] AP dashboard: http://192.168.4.1");
  if (g_staConnected) {
    Serial.println("[BOOT] Portal access: http://" + g_staIP);
  }
  Serial.printf("[BOOT] LED: %d external + onboard on GP%d/GP%d\n", NUM_LEDS, LED_PIN, ONBOARD_LED_PIN);
  Serial.printf("[BOOT] SD card: %s", g_sdMounted ? "mounted" : "not detected");
  if (g_sdMounted) Serial.printf(" (%.0fMB, %dMHz)", g_sdTotalMB, (int)(g_sdCurrentHz / 1000000));
  Serial.println();
  Serial.printf("[BOOT] Audio DAC: %s\n", g_audioReady ? "ready (ws_inv=true)" : "not detected");
  Serial.printf("[BOOT] Buttons: BOOT+GP1=play/pause, GP2=next, GP3=prev, GP4=heart\n");
  Serial.printf("[BOOT] Captive portal: active (DNS hijack + probe redirects)\n");
  Serial.printf("[BOOT] Admin mode: HEART+NEXT 3s hold, or GET /api/admin/unlock?key=<DUID>\n");
  Serial.printf("[BOOT] ESP-NOW mesh: %s (role=%s)\n", g_meshEnabled ? "enabled" : "disabled", g_meshRole.c_str());
  Serial.printf("[BOOT] Tracks: %d | Favorites: %d\n", g_wavCount, g_favCount);
  if (g_firstPlayableWav.length() > 0) {
    Serial.println("[BOOT] Press PLAY to start: " + g_firstPlayableWav);
  }
  Serial.println();
}

// ── Loop ─────────────────────────────────────────────────────
void loop() {
  // Run LED animation engine (non-blocking, millis-based)
  ledTick();

  // Handle test tone playback (normal WAV playback runs in FreeRTOS task)
  audioTick();

  // Handle hardware buttons (GP0=boot, GP1=play/pause, GP2=next, GP3=prev, GP4=heart)
  buttonsTick();

  // Admin button combo (HEART + NEXT held 3s)
  adminComboTick();

  // Captive portal DNS hijack (process DNS requests)
  captiveTick();

  // ESP-NOW mesh (beacons + audio feature broadcast)
  espnowTick();

  // Auto-switch LED mode based on playback state
  if (g_audioPlaying && g_ledMode != LED_PLAYBACK && g_ledMode != LED_NOTIFICATION) {
    ledSetMode(LED_PLAYBACK);
  } else if (!g_audioPlaying && g_playing) {
    // Audio task finished — but WHY?
    // g_audioStopRequested = user/API pressed stop → do NOT advance
    // g_audioStopRequested = false → track ended naturally → advance
    g_playing = false;
    if (!g_audioStopRequested && g_wavCount > 1) {
      // Natural end of track — auto-advance using smart playlist
      analyticsOnComplete(g_trackIndex);
      int next = playlistNextTrack(g_trackIndex);
      Serial.printf("[AUTO] Next track -> %d\n", next);
      playTrackByIndex(next);
    } else {
      // User stopped playback — stay idle
      analyticsOnStop(g_trackIndex);
      meshSendPlaySync(0x02, g_trackIndex);  // Broadcast pause to mesh
      g_audioStopRequested = false;  // reset for next play
      ledSetMode(LED_IDLE);
      Serial.println("[STOP] Playback stopped by user");
    }
  }

  // Run WiFi scan if requested by API — skip during playback (blocks SPI)
  if (!g_audioPlaying) {
    wifiDoScan();
  }

  // Monitor STA connection — skip during playback
  static unsigned long lastWifiCheck = 0;
  if (!g_audioPlaying && millis() - lastWifiCheck > 5000) {
    wifiTick();
    lastWifiCheck = millis();
  }

  // Periodic battery read (every 10s)
  static unsigned long lastBattRead = 0;
  if (millis() - lastBattRead > BATT_READ_INTERVAL) {
    batteryRead();
    lastBattRead = millis();
  }

  // Small yield to prevent WDT reset
  delay(5);
}
