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
 *           BOOT button (GPIO 0) for play/pause
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
 * Version: 2.0.0
 * Updated: 2026-03-29
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

// ── Global State ─────────────────────────────────────────────

// Device identity
String g_duid       = "DPA-AB12";
String g_fwVersion  = "2.0.0";

// Playback state
int    g_trackIndex = 0;
bool   g_playing    = false;
int    g_volume     = 75;
String g_eq         = "flat";
String g_playMode   = "normal";

// First playable WAV (scanned on boot)
String g_firstPlayableWav = "";

// LED Theme (defaults — overridden by NVS on boot)
String g_ledIdle      = "#ff4bcb";
String g_ledIdlePat   = "breathing";
String g_ledPlay      = "#00f1df";
String g_ledPlayPat   = "pulse";
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

// Battery (mock — wire ADC on GPIO 34 for real readings)
float  g_battVoltage = 3.95;
int    g_battPercent = 87;
bool   g_charging    = false;

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

// ── BOOT Button Handler ──────────────────────────────────────
static bool g_lastBtn = HIGH;
static uint32_t g_lastDebounce = 0;
static bool g_btnHandled = false;

void bootButtonTick() {
  bool btn = digitalRead(BOOT_BTN_PIN);

  if (btn != g_lastBtn) {
    g_lastDebounce = millis();
    g_lastBtn = btn;
  }

  if ((millis() - g_lastDebounce) > 50) {
    if (btn == LOW && !g_btnHandled) {
      g_btnHandled = true;

      if (g_audioPlaying) {
        // Stop playback
        Serial.println("[BTN] Stop playback");
        audioStop();
        g_playing = false;
        g_pauseCount++;
        ledSetMode(LED_IDLE);
      } else if (g_sdMounted && g_firstPlayableWav.length() > 0) {
        // Start playback of first WAV
        Serial.println("[BTN] Start playback: " + g_firstPlayableWav);

        // Ensure SD is at fast speed for playback
        if (g_sdCurrentHz != SD_FAST_HZ) {
          sdMountFast();
        }

        if (audioPlayFile(g_firstPlayableWav.c_str())) {
          g_playing = true;
          g_playCount++;
          ledSetMode(LED_PLAYBACK);
        }
      } else {
        Serial.println("[BTN] No WAV files available");
      }
    }

    if (btn == HIGH) {
      g_btnHandled = false;
    }
  }
}

// ── Setup ────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("========================================");
  Serial.println("  DPA Portal -- Firmware v2.0");
  Serial.println("========================================");

  // 0. BOOT button init
  pinMode(BOOT_BTN_PIN, INPUT_PULLUP);

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

    // Scan for first playable WAV
    g_firstPlayableWav = audioFindFirstWav();
    if (g_firstPlayableWav.length() > 0) {
      Serial.println("[BOOT] First WAV: " + g_firstPlayableWav);
    } else {
      Serial.println("[BOOT] No valid WAV files in /tracks");
    }
  } else {
    Serial.println("[BOOT] SD card not available (continuing without storage)");
  }

  // 5. Init audio engine (I2S created per-file, just marks ready)
  if (audioInit()) {
    Serial.println("[BOOT] Audio DAC ready (PCM5122 via I2S, ws_inv=true)");
  } else {
    Serial.println("[BOOT] Audio DAC not available (continuing without audio)");
  }

  // 6. Start WiFi (AP always on + STA if credentials stored)
  wifiInit(AP_PASSWORD, AP_CHANNEL, AP_MAX_CONN);

  // 7. Serve dashboard (gzipped HTML from PROGMEM)
  server.on("/", HTTP_GET, [](AsyncWebServerRequest* req) {
    AsyncWebServerResponse* response = req->beginResponse_P(
      200, "text/html", DASHBOARD_HTML, DASHBOARD_HTML_LEN
    );
    response->addHeader("Content-Encoding", "gzip");
    response->addHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    response->addHeader("Pragma", "no-cache");
    response->addHeader("Expires", "0");
    req->send(response);
  });

  // 8. Register API routes (all /api/* endpoints)
  registerApiRoutes(server);

  // 9. CORS headers for development
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "Content-Type");

  // 10. Start web server
  server.begin();
  Serial.println("[HTTP] Server started on port 80");

  // 11. Record boot time for uptime calculation
  g_bootTime = millis();

  // 12. Summary
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
  Serial.printf("[BOOT] BOOT button on GPIO %d: play/pause\n", BOOT_BTN_PIN);
  if (g_firstPlayableWav.length() > 0) {
    Serial.println("[BOOT] Press BOOT to play: " + g_firstPlayableWav);
  }
  Serial.println();
}

// ── Loop ─────────────────────────────────────────────────────
void loop() {
  // Run LED animation engine (non-blocking, millis-based)
  ledTick();

  // Handle test tone playback (normal WAV playback runs in FreeRTOS task)
  audioTick();

  // Handle BOOT button press (play/pause)
  bootButtonTick();

  // Auto-switch LED mode based on playback state
  if (g_audioPlaying && g_ledMode != LED_PLAYBACK && g_ledMode != LED_NOTIFICATION) {
    ledSetMode(LED_PLAYBACK);
  } else if (!g_audioPlaying && g_playing) {
    // Playback finished naturally
    g_playing = false;
    ledSetMode(LED_IDLE);
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

  // Small yield to prevent WDT reset
  delay(5);
}
