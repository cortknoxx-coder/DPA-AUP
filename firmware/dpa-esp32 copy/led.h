/*
 * DPA LED Controller — led.h
 * WS2812B strip control with FastLED
 * Patterns: breathing, pulse, solid, off
 * NVS persistence for theme colors
 */

#ifndef DPA_LED_H
#define DPA_LED_H

#include <FastLED.h>
#include <Preferences.h>

// ── Hardware Config ──────────────────────────────────────────
#define LED_PIN       5         // External WS2812B strip
#define NUM_LEDS      17        // 17-LED WS2812 COB strip
#define LED_TYPE      WS2812B
#define COLOR_ORDER   GRB
#define MAX_BRIGHTNESS 255

// Waveshare ESP32-S3 Zero onboard WS2812B RGB LED
#define ONBOARD_LED_PIN  21     // GPIO 21 on Waveshare S3 Zero
#define NUM_ONBOARD      1

CRGB leds[NUM_LEDS];
CRGB onboardLed[NUM_ONBOARD];

// ── LED State ────────────────────────────────────────────────
enum LedMode { LED_IDLE, LED_PLAYBACK, LED_CHARGING, LED_NOTIFICATION };
static LedMode g_ledMode = LED_IDLE;

// Notification override
static unsigned long g_notifyStart = 0;
static unsigned long g_notifyDuration = 0;
static String g_notifyColor = "";
static String g_notifyPattern = "";

// ── Extern Globals (defined in .ino) ─────────────────────────
extern String g_ledIdle, g_ledIdlePat;
extern String g_ledPlay, g_ledPlayPat;
extern String g_ledCharge, g_ledChargePat;
extern int g_brightness;
extern String g_dcnpConcert, g_dcnpVideo, g_dcnpMerch;
extern String g_dcnpSigning, g_dcnpRemix, g_dcnpOther;

// ── Color Parsing ────────────────────────────────────────────
CRGB hexToCRGB(const String& hex) {
  String h = hex;
  if (h.startsWith("#")) h = h.substring(1);
  if (h.length() < 6) return CRGB::Black;
  long val = strtol(h.c_str(), NULL, 16);
  return CRGB((val >> 16) & 0xFF, (val >> 8) & 0xFF, val & 0xFF);
}

// ── Get Current Color & Pattern ──────────────────────────────
CRGB getCurrentColor() {
  if (g_ledMode == LED_NOTIFICATION && g_notifyColor.length() > 0) {
    return hexToCRGB(g_notifyColor);
  }
  switch (g_ledMode) {
    case LED_PLAYBACK: return hexToCRGB(g_ledPlay);
    case LED_CHARGING: return hexToCRGB(g_ledCharge);
    default:           return hexToCRGB(g_ledIdle);
  }
}

String getCurrentPattern() {
  if (g_ledMode == LED_NOTIFICATION && g_notifyPattern.length() > 0) {
    return g_notifyPattern;
  }
  switch (g_ledMode) {
    case LED_PLAYBACK: return g_ledPlayPat;
    case LED_CHARGING: return g_ledChargePat;
    default:           return g_ledIdlePat;
  }
}

// ── Animation Engine (non-blocking) ──────────────────────────
void ledTick() {
  // Check if notification has expired
  if (g_ledMode == LED_NOTIFICATION) {
    if (millis() - g_notifyStart >= g_notifyDuration) {
      g_ledMode = LED_IDLE;
      g_notifyColor = "";
      g_notifyPattern = "";
    }
  }

  CRGB color = getCurrentColor();
  String pattern = getCurrentPattern();
  uint8_t bright = map(g_brightness, 0, 100, 0, MAX_BRIGHTNESS);

  if (pattern == "off") {
    fill_solid(leds, NUM_LEDS, CRGB::Black);
  }
  else if (pattern == "solid") {
    fill_solid(leds, NUM_LEDS, color);
    FastLED.setBrightness(bright);
  }
  else if (pattern == "breathing") {
    // Sine-wave breathing: 4 second cycle
    unsigned long ms = millis();
    float phase = (ms % 4000) / 4000.0f;
    float sinVal = (sin(phase * 2.0f * PI - PI / 2.0f) + 1.0f) / 2.0f; // 0.0 to 1.0
    uint8_t b = (uint8_t)(sinVal * bright);
    fill_solid(leds, NUM_LEDS, color);
    FastLED.setBrightness(b < 8 ? 8 : b); // minimum visibility
  }
  else if (pattern == "pulse") {
    // Quick flash + decay: 1.2 second cycle
    unsigned long ms = millis();
    float phase = (ms % 1200) / 1200.0f;
    float val;
    if (phase < 0.15f) {
      val = phase / 0.15f; // ramp up fast
    } else {
      val = 1.0f - ((phase - 0.15f) / 0.85f); // slow decay
    }
    val = val * val; // exponential decay
    uint8_t b = (uint8_t)(val * bright);
    fill_solid(leds, NUM_LEDS, color);
    FastLED.setBrightness(b < 4 ? 4 : b);
  }

  // Mirror to onboard LED (same color/brightness as strip)
  onboardLed[0] = leds[0];

  FastLED.show();
}

// ── Public API ───────────────────────────────────────────────
void ledInit() {
  // External strip on GPIO 5
  FastLED.addLeds<LED_TYPE, LED_PIN, COLOR_ORDER>(leds, NUM_LEDS)
    .setCorrection(TypicalLEDStrip);
  // Onboard RGB LED on GPIO 21 (Waveshare S3 Zero — uses RGB order, NOT GRB)
  FastLED.addLeds<WS2812B, ONBOARD_LED_PIN, RGB>(onboardLed, NUM_ONBOARD)
    .setCorrection(TypicalLEDStrip);
  FastLED.setBrightness(map(g_brightness, 0, 100, 0, MAX_BRIGHTNESS));
  fill_solid(leds, NUM_LEDS, CRGB::Black);
  fill_solid(onboardLed, NUM_ONBOARD, CRGB::Black);
  FastLED.show();
  Serial.println("[LED] Onboard LED on GPIO 21 + strip on GPIO 5");
}

void ledSetMode(LedMode mode) {
  g_ledMode = mode;
}

void ledNotify(const String& color, const String& pattern, unsigned long durationMs) {
  g_notifyColor = color;
  g_notifyPattern = pattern;
  g_notifyDuration = durationMs;
  g_notifyStart = millis();
  g_ledMode = LED_NOTIFICATION;
}

// ── NVS Persistence ──────────────────────────────────────────
void ledSaveToNVS() {
  Preferences prefs;
  prefs.begin("dpa_led", false);
  prefs.putString("idle_c", g_ledIdle);
  prefs.putString("idle_p", g_ledIdlePat);
  prefs.putString("play_c", g_ledPlay);
  prefs.putString("play_p", g_ledPlayPat);
  prefs.putString("chrg_c", g_ledCharge);
  prefs.putString("chrg_p", g_ledChargePat);
  prefs.putInt("bright", g_brightness);
  prefs.putString("dcnp_cn", g_dcnpConcert);
  prefs.putString("dcnp_vd", g_dcnpVideo);
  prefs.putString("dcnp_mr", g_dcnpMerch);
  prefs.putString("dcnp_sg", g_dcnpSigning);
  prefs.putString("dcnp_rx", g_dcnpRemix);
  prefs.putString("dcnp_ot", g_dcnpOther);
  prefs.end();
  Serial.println("[LED] Theme saved to NVS");
}

void ledLoadFromNVS() {
  Preferences prefs;
  prefs.begin("dpa_led", true); // read-only
  g_ledIdle     = prefs.getString("idle_c", g_ledIdle);
  g_ledIdlePat  = prefs.getString("idle_p", g_ledIdlePat);
  g_ledPlay     = prefs.getString("play_c", g_ledPlay);
  g_ledPlayPat  = prefs.getString("play_p", g_ledPlayPat);
  g_ledCharge   = prefs.getString("chrg_c", g_ledCharge);
  g_ledChargePat= prefs.getString("chrg_p", g_ledChargePat);
  g_brightness  = prefs.getInt("bright", g_brightness);
  g_dcnpConcert = prefs.getString("dcnp_cn", g_dcnpConcert);
  g_dcnpVideo   = prefs.getString("dcnp_vd", g_dcnpVideo);
  g_dcnpMerch   = prefs.getString("dcnp_mr", g_dcnpMerch);
  g_dcnpSigning = prefs.getString("dcnp_sg", g_dcnpSigning);
  g_dcnpRemix   = prefs.getString("dcnp_rx", g_dcnpRemix);
  g_dcnpOther   = prefs.getString("dcnp_ot", g_dcnpOther);
  prefs.end();
  Serial.println("[LED] Theme loaded from NVS");
}

#endif // DPA_LED_H
