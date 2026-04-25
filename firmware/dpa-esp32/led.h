/*
 * DPA LED Controller — led.h
 * WS2812B strip control with FastLED
 *
 * Base patterns:  breathing, pulse, solid, off
 * Notification patterns:
 *   chase_fwd  — light races start→end (NEXT track)
 *   chase_rev  — light races end→start (PREV track)
 *   heartbeat  — double-pulse like a real heartbeat (HEART/favorite)
 *   comet      — spinning comet tail (PLAY started)
 *   fade_out   — color fades to black (STOP/pause)
 *
 * NVS persistence for theme colors
 */

#ifndef DPA_LED_H
#define DPA_LED_H

// FastLED on ESP32-S3 + WiFi AP: the default RMT driver gets preempted by
// WiFi interrupts mid-frame, causing bit-slip on the tail of the WS2812
// stream (pixels 14-17 display wrong bytes). Fixes:
//   1) FASTLED_ALLOW_INTERRUPTS 0 — blocks IRQs during the ~510µs frame
//   2) FASTLED_RMT_MAX_CHANNELS 1  — serialize RMT so no channel races
//   3) FASTLED_RMT_BUILTIN_DRIVER  — use ESP-IDF RMT driver (more robust)
#define FASTLED_ALLOW_INTERRUPTS 0
#define FASTLED_RMT_MAX_CHANNELS 1
#define FASTLED_RMT_BUILTIN_DRIVER 1
#include <FastLED.h>
#include <Preferences.h>
#include "audio_reactive.h"  // g_audioFeatures for audio-reactive patterns

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
static LedMode g_ledModeBeforeNotify = LED_IDLE; // restore after notification

// Notification override
static unsigned long g_notifyStart = 0;
static unsigned long g_notifyDuration = 0;
static String g_notifyColor = "";
static String g_notifyPattern = "";
static bool g_ledIdleFullSpectrum = false;
static bool g_ledPlayFullSpectrum = false;
static bool g_ledChargeFullSpectrum = false;
static bool g_ledPersistDirty = false;

// ── Extern Globals (defined in .ino) ─────────────────────────
extern String g_ledIdle, g_ledIdlePat;
extern String g_ledPlay, g_ledPlayPat;
extern String g_ledCharge, g_ledChargePat;
extern int g_brightness;
extern int g_volume;
extern String g_ledGradEnd;
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

const String& getCurrentPattern() {
  if (g_ledMode == LED_NOTIFICATION && g_notifyPattern.length() > 0) {
    return g_notifyPattern;
  }
  switch (g_ledMode) {
    case LED_PLAYBACK: return g_ledPlayPat;
    case LED_CHARGING: return g_ledChargePat;
    default:           return g_ledIdlePat;
  }
}

bool ledModeUsesFullSpectrum(LedMode mode) {
  switch (mode) {
    case LED_PLAYBACK: return g_ledPlayFullSpectrum;
    case LED_CHARGING: return g_ledChargeFullSpectrum;
    default:           return g_ledIdleFullSpectrum;
  }
}

void ledSetModeFullSpectrum(LedMode mode, bool enabled) {
  switch (mode) {
    case LED_PLAYBACK: g_ledPlayFullSpectrum = enabled; break;
    case LED_CHARGING: g_ledChargeFullSpectrum = enabled; break;
    default:           g_ledIdleFullSpectrum = enabled; break;
  }
}

// ── Helpers ──────────────────────────────────────────────────

// Blend a pixel toward a color with distance-based falloff
static inline void setPixelWithTail(int pos, CRGB color, int tailLen) {
  for (int t = 0; t <= tailLen; t++) {
    int idx = pos - t;
    if (idx < 0 || idx >= NUM_LEDS) continue;
    // Head is full brightness, tail fades exponentially
    uint8_t fade = (t == 0) ? 255 : (uint8_t)(255.0f * powf(0.4f, (float)t));
    CRGB c = color;
    c.nscale8(fade);
    // Additive blend so overlapping tails look nice
    leds[idx] |= c;
  }
}

static inline void setPixelWithTailRev(int pos, CRGB color, int tailLen) {
  for (int t = 0; t <= tailLen; t++) {
    int idx = pos + t;
    if (idx < 0 || idx >= NUM_LEDS) continue;
    uint8_t fade = (t == 0) ? 255 : (uint8_t)(255.0f * powf(0.4f, (float)t));
    CRGB c = color;
    c.nscale8(fade);
    leds[idx] |= c;
  }
}

// ── Gradient End Color ───────────────────────────────────────
CRGB getGradientEnd() {
  return hexToCRGB(g_ledGradEnd);
}

// ── VU Idle Fallback (self-running preview) ──────────────────
static inline void vuIdleFallback(CRGB color, CRGB gradEnd, uint8_t bright) {
  unsigned long ms = millis();
  float phase = (ms % 1800) / 1800.0f;
  float pulse = (sin(phase * 2.0f * PI - PI / 2.0f) + 1.0f) / 2.0f;
  float eased = pulse * pulse;
  int center = NUM_LEDS / 2;
  int litHalf = 1 + (int)(eased * center);

  fill_solid(leds, NUM_LEDS, CRGB::Black);
  for (int i = 0; i <= litHalf; i++) {
    float ratio = center > 0 ? (float)i / (float)center : 0.0f;
    CRGB c = blend(color, gradEnd, (uint8_t)(ratio * 255));
    if (center + i < NUM_LEDS) leds[center + i] = c;
    if (center - i >= 0) leds[center - i] = c;
  }

  FastLED.setBrightness((uint8_t)(bright * (0.25f + eased * 0.75f)));
}

// ── Animation Engine (non-blocking) ──────────────────────────
void ledTick() {
  // Reset stale static state when pattern or mode changes
  static String s_lastPattern = "";
  static LedMode s_lastMode = LED_IDLE;
  const String& _curPat = getCurrentPattern();
  if (_curPat != s_lastPattern || g_ledMode != s_lastMode) {
    s_lastPattern = _curPat;
    s_lastMode = g_ledMode;
    // Clear strip to avoid ghosting from previous pattern's static vars
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    FastLED.show();
  }

  // Check if notification has expired
  if (g_ledMode == LED_NOTIFICATION) {
    if (millis() - g_notifyStart >= g_notifyDuration) {
      // fade_out means we stopped — go to IDLE, not back to PLAYBACK
      if (g_notifyPattern == "fade_out") {
        g_ledMode = LED_IDLE;
      } else {
        g_ledMode = g_ledModeBeforeNotify;  // restore previous mode
      }
      g_notifyColor = "";
      g_notifyPattern = "";
    }
  }

  CRGB color = getCurrentColor();
  const String& pattern = getCurrentPattern();
  uint8_t bright = map(g_brightness, 0, 100, 0, MAX_BRIGHTNESS);

  // Always set brightness at the start of each frame to avoid stale values
  FastLED.setBrightness(bright);

  // ── BASE PATTERNS (looping) ──────────────────────────────

  if (pattern == "off") {
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    FastLED.setBrightness(0);
  }
  else if (pattern == "solid") {
    fill_solid(leds, NUM_LEDS, color);
    FastLED.setBrightness(bright);
  }
  else if (pattern == "breathing") {
    // Sine-wave breathing: 4 second cycle
    unsigned long ms = millis();
    float phase = (ms % 4000) / 4000.0f;
    float sinVal = (sin(phase * 2.0f * PI - PI / 2.0f) + 1.0f) / 2.0f;
    uint8_t b = (uint8_t)(sinVal * bright);
    fill_solid(leds, NUM_LEDS, color);
    FastLED.setBrightness(b < 8 ? 8 : b);
  }
  else if (pattern == "pulse") {
    // Quick flash + decay: 1.2 second cycle
    unsigned long ms = millis();
    float phase = (ms % 1200) / 1200.0f;
    float val;
    if (phase < 0.15f) {
      val = phase / 0.15f;
    } else {
      val = 1.0f - ((phase - 0.15f) / 0.85f);
    }
    val = val * val;
    uint8_t b = (uint8_t)(val * bright);
    fill_solid(leds, NUM_LEDS, color);
    FastLED.setBrightness(b < 4 ? 4 : b);
  }

  // ── NOTIFICATION PATTERNS (one-shot, time-based) ─────────

  else if (pattern == "chase_fwd") {
    // NEXT TRACK: Light races forward with comet tail (LED 0 → 16)
    // Duration controls speed. Typical: 400ms
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    FastLED.setBrightness(bright);
    unsigned long elapsed = millis() - g_notifyStart;
    float progress = (float)elapsed / (float)g_notifyDuration;
    if (progress > 1.0f) progress = 1.0f;

    // Head position sweeps across strip
    float headF = progress * (NUM_LEDS + 4);  // overshoot for tail to clear
    int head = (int)headF;

    // Draw comet: bright head + 4-pixel fading tail
    for (int t = 0; t <= 4; t++) {
      int idx = head - t;
      if (idx < 0 || idx >= NUM_LEDS) continue;
      uint8_t fade = (t == 0) ? 255 : (uint8_t)(255.0f * powf(0.35f, (float)t));
      CRGB c = color;
      c.nscale8(fade);
      leds[idx] = c;
    }
  }

  else if (pattern == "chase_rev") {
    // PREV TRACK: Light races backward with comet tail (LED 16 → 0)
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    FastLED.setBrightness(bright);
    unsigned long elapsed = millis() - g_notifyStart;
    float progress = (float)elapsed / (float)g_notifyDuration;
    if (progress > 1.0f) progress = 1.0f;

    // Head sweeps from end to start
    float headF = (1.0f - progress) * (NUM_LEDS - 1) + progress * (-4);
    int head = (int)headF;

    // Draw comet tail trailing behind (toward higher indices)
    for (int t = 0; t <= 4; t++) {
      int idx = head + t;
      if (idx < 0 || idx >= NUM_LEDS) continue;
      uint8_t fade = (t == 0) ? 255 : (uint8_t)(255.0f * powf(0.35f, (float)t));
      CRGB c = color;
      c.nscale8(fade);
      leds[idx] = c;
    }
  }

  else if (pattern == "heartbeat") {
    // HEART/FAVORITE: Double-pulse like a real heartbeat (lub-DUB)
    // Typical duration: 700ms
    // Timeline: [0-15%] first beat up, [15-30%] first beat down,
    //           [30-45%] second beat UP (stronger), [45-70%] second beat down,
    //           [70-100%] fade to black
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    unsigned long elapsed = millis() - g_notifyStart;
    float t = (float)elapsed / (float)g_notifyDuration;
    if (t > 1.0f) t = 1.0f;

    float val = 0.0f;
    if (t < 0.12f) {
      // First beat — ramp up (lub)
      val = t / 0.12f * 0.6f;
    } else if (t < 0.22f) {
      // First beat — ramp down
      val = 0.6f * (1.0f - (t - 0.12f) / 0.10f);
    } else if (t < 0.30f) {
      // Brief pause between beats
      val = 0.0f;
    } else if (t < 0.42f) {
      // Second beat — ramp up HARD (DUB)
      val = (t - 0.30f) / 0.12f;
    } else if (t < 0.65f) {
      // Second beat — slow decay
      val = 1.0f - (t - 0.42f) / 0.23f;
      val = val * val;  // exponential decay
    } else {
      // Fade out
      val = 0.3f * (1.0f - (t - 0.65f) / 0.35f);
      if (val < 0) val = 0;
    }

    uint8_t b = (uint8_t)(val * bright);
    fill_solid(leds, NUM_LEDS, color);
    FastLED.setBrightness(b < 2 ? 2 : b);

    // Expand from center on the big beat for extra drama
    if (t >= 0.30f && t < 0.55f) {
      float expand = (t < 0.42f) ? (t - 0.30f) / 0.12f : 1.0f - (t - 0.42f) / 0.13f;
      int center = NUM_LEDS / 2;
      int radius = (int)(expand * (NUM_LEDS / 2));
      for (int i = 0; i < NUM_LEDS; i++) {
        int dist = abs(i - center);
        if (dist > radius + 1) {
          leds[i].nscale8(64);  // dim pixels outside the pulse
        }
      }
    }
  }

  else if (pattern == "comet") {
    // Spinning comet that wraps around the strip like a ring
    // Works as both:
    //   BASE pattern (looping): smooth 2-second revolution, runs forever
    //   NOTIFICATION (one-shot): 1.5 rev ease-in-out with fadeout
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    FastLED.setBrightness(bright);

    bool isNotification = (g_ledMode == LED_NOTIFICATION);
    int head;
    float globalFade = 1.0f;

    if (isNotification) {
      // One-shot: 1.5 revs with ease-in-out, fade at end
      unsigned long elapsed = millis() - g_notifyStart;
      float t = (float)elapsed / (float)g_notifyDuration;
      if (t > 1.0f) t = 1.0f;
      float eased = t < 0.5f ? 2.0f * t * t : 1.0f - powf(-2.0f * t + 2.0f, 2) / 2.0f;
      float pos = eased * 1.5f * NUM_LEDS;
      head = ((int)pos) % NUM_LEDS;
      globalFade = (t > 0.8f) ? 1.0f - (t - 0.8f) / 0.2f : 1.0f;
    } else {
      // Base pattern: continuous smooth loop, 2-second revolution
      unsigned long ms = millis();
      float phase = (ms % 2000) / 2000.0f;
      head = (int)(phase * NUM_LEDS) % NUM_LEDS;
    }

    // Draw comet: bright head + 6-pixel fading tail (wrapping around)
    int tailLen = 6;
    for (int i = 0; i <= tailLen; i++) {
      int idx = (head - i + NUM_LEDS) % NUM_LEDS;
      float fade = (i == 0) ? 1.0f : powf(0.45f, (float)i);
      CRGB c = color;
      c.nscale8((uint8_t)(fade * globalFade * 255));
      leds[idx] = c;
    }

    // Bright white spark at the head
    if (globalFade > 0.3f) {
      CRGB spark = CRGB::White;
      spark.nscale8((uint8_t)(96 * globalFade));
      leds[head] += spark;
    }
  }

  else if (pattern == "fade_out") {
    // STOP/PAUSE: Current color rapidly fades to black
    unsigned long elapsed = millis() - g_notifyStart;
    float t = (float)elapsed / (float)g_notifyDuration;
    if (t > 1.0f) t = 1.0f;
    float val = 1.0f - t;
    val = val * val * val;
    uint8_t b = (uint8_t)(val * bright);
    fill_solid(leds, NUM_LEDS, color);
    FastLED.setBrightness(b < 1 ? 0 : b);
  }

  else if (pattern == "flash_burst") {
    // Front-loaded multi-flash burst for high-energy announcements.
    fill_solid(leds, NUM_LEDS, color);
    unsigned long elapsed = millis() - g_notifyStart;
    float t = (float)elapsed / (float)g_notifyDuration;
    if (t > 1.0f) t = 1.0f;

    const int flashes = g_notifyDuration >= 1500 ? 3 : 2;
    float cycle = t * flashes;
    float local = cycle - floorf(cycle);
    float val = 0.0f;
    if (local < 0.12f) {
      val = local / 0.12f;
    } else if (local < 0.30f) {
      val = 1.0f - (local - 0.12f) / 0.18f;
    }
    if (t > 0.88f) {
      val *= (1.0f - (t - 0.88f) / 0.12f);
    }
    if (val < 0) val = 0;
    uint8_t b = (uint8_t)(val * bright);
    FastLED.setBrightness(b < 2 ? 0 : b);
  }

  else if (pattern == "flash_hold") {
    // Quick alert flashes that settle into a confident hold.
    fill_solid(leds, NUM_LEDS, color);
    unsigned long elapsed = millis() - g_notifyStart;
    float t = (float)elapsed / (float)g_notifyDuration;
    if (t > 1.0f) t = 1.0f;

    float val = 0.0f;
    if (t < 0.42f) {
      float burst = (t / 0.42f) * 3.0f;
      float local = burst - floorf(burst);
      if (local < 0.12f) {
        val = local / 0.12f;
      } else if (local < 0.28f) {
        val = 1.0f - (local - 0.12f) / 0.16f;
      }
    } else if (t < 0.84f) {
      val = 0.85f;
    } else {
      val = 0.85f * (1.0f - (t - 0.84f) / 0.16f);
    }

    if (val < 0) val = 0;
    uint8_t b = (uint8_t)(val * bright);
    FastLED.setBrightness(b < 2 ? 0 : b);
  }

  else if (pattern == "fade_glow") {
    // Slow cinematic glow for video-style drops.
    fill_solid(leds, NUM_LEDS, color);
    unsigned long elapsed = millis() - g_notifyStart;
    float t = (float)elapsed / (float)g_notifyDuration;
    if (t > 1.0f) t = 1.0f;

    float val = 0.0f;
    if (t < 0.28f) {
      float ramp = t / 0.28f;
      val = ramp * ramp;
    } else if (t < 0.72f) {
      val = 1.0f;
    } else {
      float fade = 1.0f - (t - 0.72f) / 0.28f;
      val = fade * fade;
    }

    uint8_t b = (uint8_t)(val * bright);
    FastLED.setBrightness(b < 2 ? 0 : b);
  }

  else if (pattern == "rhythmic_pulse") {
    // Even, BPM-like pulses for remix/stem drops.
    fill_solid(leds, NUM_LEDS, color);
    unsigned long elapsed = millis() - g_notifyStart;
    float t = (float)elapsed / (float)g_notifyDuration;
    if (t > 1.0f) t = 1.0f;

    const float beatWindowMs = 500.0f;
    float beatPhase = fmodf((float)elapsed, beatWindowMs) / beatWindowMs;
    float val = 0.0f;
    if (beatPhase < 0.18f) {
      val = beatPhase / 0.18f;
    } else if (beatPhase < 0.48f) {
      val = 1.0f - (beatPhase - 0.18f) / 0.30f;
    }
    if (t > 0.90f) {
      val *= (1.0f - (t - 0.90f) / 0.10f);
    }
    if (val < 0) val = 0;

    uint8_t b = (uint8_t)(val * bright);
    fill_solid(leds, NUM_LEDS, color);
    FastLED.setBrightness(b < 2 ? 0 : b);
  }

  // ── NEW BASE PATTERNS ──────────────────────────────────

  else if (pattern == "rainbow") {
    // Rainbow Flow: smooth HSV gradient slides across strip
    // Supports genre mode: when color + gradEnd are set and different,
    // cycles within that hue range instead of full spectrum.
    FastLED.setBrightness(bright);
    unsigned long ms = millis();
    uint8_t baseHue = (ms / 20) & 0xFF;  // ~5 sec full cycle

    CRGB gradEnd = getGradientEnd();
    bool genreMode = !ledModeUsesFullSpectrum(g_ledMode)
                  && (color.r | color.g | color.b) != 0
                  && (gradEnd.r | gradEnd.g | gradEnd.b) != 0
                  && (color != gradEnd);

    if (genreMode) {
      // Genre rainbow: cycle within the hue range defined by color → gradEnd
      CHSV h1 = rgb2hsv_approximate(color);
      CHSV h2 = rgb2hsv_approximate(gradEnd);
      uint8_t hueSpan = h2.hue - h1.hue;  // wraps naturally in uint8_t
      for (int i = 0; i < NUM_LEDS; i++) {
        uint8_t pos = baseHue + (i * 255 / NUM_LEDS);
        uint8_t hue = h1.hue + scale8(pos, hueSpan);
        leds[i] = CHSV(hue, 240, 255);
      }
    } else {
      // Classic full-spectrum rainbow
      for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = CHSV(baseHue + (i * 255 / NUM_LEDS), 240, 255);
      }
    }
  }

  else if (pattern == "fire") {
    // Fire: flickering orange/red/yellow with random heat
    // Uses a simplified heat map with cooling and sparking
    FastLED.setBrightness(bright);
    static uint8_t heat[NUM_LEDS] = {};

    // Cool down every cell a little
    for (int i = 0; i < NUM_LEDS; i++) {
      uint8_t cool = random8(20, 55);
      heat[i] = (heat[i] > cool) ? heat[i] - cool : 0;
    }

    // Heat rises: shift heat upward
    for (int i = NUM_LEDS - 1; i >= 2; i--) {
      heat[i] = (heat[i - 1] + heat[i - 2] + heat[i - 2]) / 3;
    }

    // Random sparks near bottom
    if (random8() < 160) {
      int y = random8(3);
      heat[y] = qadd8(heat[y], random8(160, 255));
    }

    // Map heat to color (black → red → orange → yellow → white)
    for (int i = 0; i < NUM_LEDS; i++) {
      uint8_t t = heat[i];
      CRGB c;
      if (t < 85) {
        c = CRGB(t * 3, 0, 0);
      } else if (t < 170) {
        c = CRGB(255, (t - 85) * 3, 0);
      } else {
        c = CRGB(255, 255, (t - 170) * 3);
      }
      // Tint toward the user's chosen color
      CRGB blend = color;
      blend.nscale8(64);  // subtle tint
      leds[i] = c + blend;
    }
  }

  else if (pattern == "sparkle") {
    // Sparkle: base color with random bright white flashes
    FastLED.setBrightness(bright);
    fill_solid(leds, NUM_LEDS, color);
    // Dim the base slightly
    for (int i = 0; i < NUM_LEDS; i++) leds[i].nscale8(140);
    // 2-3 random sparkles per frame
    for (int s = 0; s < 3; s++) {
      if (random8() < 100) {
        int idx = random8(NUM_LEDS);
        leds[idx] = CRGB::White;
      }
    }
  }

  else if (pattern == "wave") {
    // Wave: sine wave of brightness rolls across the strip
    // Smooth, elegant, 3-second cycle
    FastLED.setBrightness(bright);
    unsigned long ms = millis();
    float phase = (ms % 3000) / 3000.0f * 2.0f * PI;
    for (int i = 0; i < NUM_LEDS; i++) {
      float pos = (float)i / (float)NUM_LEDS * 2.0f * PI;
      float val = (sinf(phase + pos) + 1.0f) / 2.0f;  // 0.0 to 1.0
      val = val * 0.85f + 0.15f;  // minimum 15% brightness
      CRGB c = color;
      c.nscale8((uint8_t)(val * 255));
      leds[i] = c;
    }
  }

  else if (pattern == "dual_comet") {
    // Dual Comet: two comets chasing each other in opposite directions
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    FastLED.setBrightness(bright);
    unsigned long ms = millis();
    float phase = (ms % 2000) / 2000.0f;

    int head1 = (int)(phase * NUM_LEDS) % NUM_LEDS;
    int head2 = (int)(((phase + 0.5f) * NUM_LEDS)) % NUM_LEDS;

    for (int t = 0; t <= 4; t++) {
      int idx = (head1 - t + NUM_LEDS) % NUM_LEDS;
      float fade = (t == 0) ? 1.0f : powf(0.4f, (float)t);
      CRGB c = color;
      c.nscale8((uint8_t)(fade * 255));
      leds[idx] |= c;
    }

    CRGB color2 = color;
    CHSV hsv = rgb2hsv_approximate(color2);
    hsv.hue += 85;
    color2 = hsv;
    for (int t = 0; t <= 4; t++) {
      int idx = (head2 + t) % NUM_LEDS;
      float fade = (t == 0) ? 1.0f : powf(0.4f, (float)t);
      CRGB c = color2;
      c.nscale8((uint8_t)(fade * 255));
      leds[idx] |= c;
    }
  }

  else if (pattern == "meteor") {
    // Meteor Rain: a fading head streaks down the strip
    FastLED.setBrightness(bright);
    for (int i = 0; i < NUM_LEDS; i++) {
      leds[i].nscale8(180);
    }
    static uint8_t meteorPos = 0;
    static unsigned long lastMeteorMs = 0;

    unsigned long ms = millis();
    if (ms - lastMeteorMs > 40) {
      lastMeteorMs = ms;
      meteorPos += 1;
      if (meteorPos >= NUM_LEDS + 5) {
        meteorPos = 0;
      }
      int pos = meteorPos;
      if (pos < NUM_LEDS) {
        leds[pos] = color;
        CRGB spark = CRGB::White;
        spark.nscale8(160);
        leds[pos] += spark;
      }
    }
  }

  else if (pattern == "theater") {
    // Theater Chase: every 3rd LED lit, shifts each frame — marquee style
    FastLED.setBrightness(bright);
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    unsigned long ms = millis();
    int offset = (ms / 150) % 3;  // shift every 150ms
    for (int i = 0; i < NUM_LEDS; i++) {
      if ((i + offset) % 3 == 0) {
        leds[i] = color;
      }
    }
  }

  else if (pattern == "bounce") {
    // Bouncing Ball: dot bounces end-to-end with gravity physics
    FastLED.setBrightness(bright);
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    unsigned long ms = millis();
    // Period: 1.5 seconds per bounce
    float t = (ms % 1500) / 1500.0f;
    // Parabolic trajectory: height = 1 - (2t-1)^2
    float pos = 1.0f - (2.0f * t - 1.0f) * (2.0f * t - 1.0f);
    int idx = (int)(pos * (NUM_LEDS - 1));
    if (idx < 0) idx = 0;
    if (idx >= NUM_LEDS) idx = NUM_LEDS - 1;

    // Ball with small glow
    leds[idx] = color;
    if (idx > 0) { CRGB c = color; c.nscale8(80); leds[idx-1] = c; }
    if (idx < NUM_LEDS-1) { CRGB c = color; c.nscale8(80); leds[idx+1] = c; }
    // White spark on the ball
    CRGB spark = CRGB::White; spark.nscale8(100); leds[idx] += spark;
  }

  // ── AUDIO-REACTIVE PATTERNS (modulated by live audio features) ──
  // When not playing, these fall back to breathing.

  else if (pattern == "audio_pulse") {
    // Brightness 20-100% tracks audio envelope
    float env = g_audioFeatures.active ? g_audioFeatures.envelope : 0.0f;
    if (!g_audioFeatures.active) {
      // Fallback to breathing when not playing
      unsigned long ms = millis();
      float phase = (ms % 4000) / 4000.0f;
      float sinVal = (sin(phase * 2.0f * PI - PI / 2.0f) + 1.0f) / 2.0f;
      uint8_t b = (uint8_t)(sinVal * bright);
      fill_solid(leds, NUM_LEDS, color);
      FastLED.setBrightness(b < 8 ? 8 : b);
    } else {
      float val = 0.2f + env * 0.8f;  // 20-100%
      uint8_t b = (uint8_t)(val * bright);
      fill_solid(leds, NUM_LEDS, color);
      FastLED.setBrightness(b < 8 ? 8 : b);
    }
  }

  else if (pattern == "audio_bass") {
    // Flash on bass hits, 100ms decay
    float bass = g_audioFeatures.active ? audioReactiveLowBandLevel() : 0.0f;
    if (!g_audioFeatures.active) {
      unsigned long ms = millis();
      float phase = (ms % 4000) / 4000.0f;
      float sinVal = (sin(phase * 2.0f * PI - PI / 2.0f) + 1.0f) / 2.0f;
      uint8_t b = (uint8_t)(sinVal * bright);
      fill_solid(leds, NUM_LEDS, color);
      FastLED.setBrightness(b < 8 ? 8 : b);
    } else {
      // Bass-driven: sharp attack, fast decay
      static float bassDecay = 0.0f;
      if (bass > bassDecay) bassDecay = bass;
      else bassDecay *= 0.85f;  // ~100ms decay at 30fps
      float val = 0.1f + bassDecay * 0.9f;
      uint8_t b = (uint8_t)(val * bright);
      fill_solid(leds, NUM_LEDS, color);
      FastLED.setBrightness(b < 4 ? 4 : b);
    }
  }

  else if (pattern == "audio_beat") {
    // White strobe on beat, 50ms flash, 200ms lockout
    if (!g_audioFeatures.active) {
      unsigned long ms = millis();
      float phase = (ms % 4000) / 4000.0f;
      float sinVal = (sin(phase * 2.0f * PI - PI / 2.0f) + 1.0f) / 2.0f;
      uint8_t b = (uint8_t)(sinVal * bright);
      fill_solid(leds, NUM_LEDS, color);
      FastLED.setBrightness(b < 8 ? 8 : b);
    } else {
      static unsigned long lastBeatFlash = 0;
      if (g_audioFeatures.beatFlag) lastBeatFlash = millis();
      unsigned long since = millis() - lastBeatFlash;
      if (since < 50) {
        // White strobe
        fill_solid(leds, NUM_LEDS, CRGB::White);
        FastLED.setBrightness(bright);
      } else if (since < 200) {
        // Quick fade back to color
        float fade = 1.0f - (float)(since - 50) / 150.0f;
        CRGB c = blend(color, CRGB::White, (uint8_t)(fade * 128));
        fill_solid(leds, NUM_LEDS, c);
        FastLED.setBrightness(bright);
      } else {
        // Dim base color between beats
        float env = g_audioFeatures.envelope;
        uint8_t b = (uint8_t)((0.15f + env * 0.3f) * bright);
        fill_solid(leds, NUM_LEDS, color);
        FastLED.setBrightness(b < 4 ? 4 : b);
      }
    }
  }

  // ── VU METER PATTERNS ──────────────────────────────────────
  // All VU patterns are real-time audio-reactive using RMS/peak/bass

  else if (pattern == "audio_vu" || pattern == "vu_classic") {
    // Classic VU: center-out, user gradient color (start → end)
    if (!g_audioFeatures.active) { vuIdleFallback(color, getGradientEnd(), bright); }
    else {
      fill_solid(leds, NUM_LEDS, CRGB::Black);
      FastLED.setBrightness(bright);
      CRGB gradEnd = getGradientEnd();
      float level = g_audioFeatures.rms * 3.0f;
      if (level > 1.0f) level = 1.0f;
      int litCount = (int)(level * (NUM_LEDS / 2));
      int center = NUM_LEDS / 2;
      for (int i = 0; i <= litCount; i++) {
        float ratio = (float)i / (float)(NUM_LEDS / 2);
        CRGB c = blend(color, gradEnd, (uint8_t)(ratio * 255));
        if (center + i < NUM_LEDS) leds[center + i] = c;
        if (center - i >= 0) leds[center - i] = c;
      }
    }
  }

  else if (pattern == "vu_fill") {
    // Fill VU: left-to-right level meter
    if (!g_audioFeatures.active) { vuIdleFallback(color, getGradientEnd(), bright); }
    else {
      fill_solid(leds, NUM_LEDS, CRGB::Black);
      FastLED.setBrightness(bright);
      CRGB gradEnd = getGradientEnd();
      float level = g_audioFeatures.rms * 3.0f;
      if (level > 1.0f) level = 1.0f;
      int litCount = (int)(level * NUM_LEDS);
      for (int i = 0; i < litCount && i < NUM_LEDS; i++) {
        float ratio = (float)i / (float)(NUM_LEDS - 1);
        leds[i] = blend(color, gradEnd, (uint8_t)(ratio * 255));
      }
    }
  }

  else if (pattern == "vu_peak") {
    // Peak Hold VU: fill plus a retained peak indicator
    static float peakHold = 0.0f;
    static unsigned long peakTime = 0;
    if (!g_audioFeatures.active) { vuIdleFallback(color, getGradientEnd(), bright); peakHold = 0; }
    else {
      fill_solid(leds, NUM_LEDS, CRGB::Black);
      FastLED.setBrightness(bright);
      CRGB gradEnd = getGradientEnd();
      float level = g_audioFeatures.rms * 3.0f;
      if (level > 1.0f) level = 1.0f;
      if (level >= peakHold) { peakHold = level; peakTime = millis(); }
      else if (millis() - peakTime > 400) { peakHold *= 0.96f; }
      int litCount = (int)(level * NUM_LEDS);
      for (int i = 0; i < litCount && i < NUM_LEDS; i++) {
        float ratio = (float)i / (float)(NUM_LEDS - 1);
        leds[i] = blend(color, gradEnd, (uint8_t)(ratio * 255));
      }
      int peakIdx = (int)(peakHold * (NUM_LEDS - 1));
      if (peakIdx >= NUM_LEDS) peakIdx = NUM_LEDS - 1;
      if (peakIdx >= litCount) {
        leds[peakIdx] = CRGB::White;
        leds[peakIdx].nscale8(200);
      }
    }
  }

  else if (pattern == "vu_split") {
    // Split Stereo VU: independent left/right response
    if (!g_audioFeatures.active) { vuIdleFallback(color, getGradientEnd(), bright); }
    else {
      fill_solid(leds, NUM_LEDS, CRGB::Black);
      FastLED.setBrightness(bright);
      CRGB gradEnd = getGradientEnd();
      int half = NUM_LEDS / 2;
      float levelL = g_audioFeatures.peakL * 2.5f;
      float levelR = g_audioFeatures.peakR * 2.5f;
      if (levelL > 1.0f) levelL = 1.0f;
      if (levelR > 1.0f) levelR = 1.0f;
      int litL = (int)(levelL * half);
      for (int i = 0; i < litL && i < half; i++) {
        float ratio = half > 1 ? (float)i / (float)(half - 1) : 0.0f;
        leds[half - 1 - i] = blend(color, gradEnd, (uint8_t)(ratio * 255));
      }
      int litR = (int)(levelR * (NUM_LEDS - half));
      for (int i = 0; i < litR && (half + i) < NUM_LEDS; i++) {
        float ratio = (NUM_LEDS - half) > 1 ? (float)i / (float)(NUM_LEDS - half - 1) : 0.0f;
        leds[half + i] = blend(color, gradEnd, (uint8_t)(ratio * 255));
      }
    }
  }

  else if (pattern == "vu_bass") {
    // Bass VU: low-frequency energy expands from the center
    static float bassDecayVU = 0.0f;
    if (!g_audioFeatures.active) { vuIdleFallback(color, getGradientEnd(), bright); bassDecayVU = 0; }
    else {
      fill_solid(leds, NUM_LEDS, CRGB::Black);
      FastLED.setBrightness(bright);
      CRGB gradEnd = getGradientEnd();
      float bass = audioReactiveLowBandLevel() * 4.0f;
      if (bass > 1.0f) bass = 1.0f;
      if (bass > bassDecayVU) bassDecayVU = bass;
      else bassDecayVU *= 0.88f;
      int litCount = (int)(bassDecayVU * NUM_LEDS);
      int center = NUM_LEDS / 2;
      int litHalf = litCount / 2;
      for (int i = 0; i <= litHalf && i < center + 1; i++) {
        float ratio = center > 0 ? (float)i / (float)center : 0.0f;
        CRGB c = blend(color, gradEnd, (uint8_t)(ratio * 255));
        if (bass > 0.7f) c = blend(c, CRGB::White, 60);
        if (center + i < NUM_LEDS) leds[center + i] = c;
        if (center - i >= 0) leds[center - i] = c;
      }
    }
  }

  else if (pattern == "vu_energy") {
    // Energy VU: low/mid/high analysis drives different strip zones.
    if (!g_audioFeatures.active) { vuIdleFallback(color, getGradientEnd(), bright); }
    else {
      CRGB gradEnd = getGradientEnd();
      float low = audioReactiveLowBandLevel();
      float mid = audioReactiveMidBandLevel();
      float high = audioReactiveHighBandLevel();
      float level = 0.15f + ((low * 0.4f) + (mid * 0.35f) + (high * 0.25f)) * 0.85f;
      uint8_t b = (uint8_t)(level * bright);
      const int lowEnd = NUM_LEDS / 3;
      const int midEnd = (NUM_LEDS * 2) / 3;
      for (int i = 0; i < NUM_LEDS; i++) {
        float ratio = (float)i / (float)(NUM_LEDS - 1);
        CRGB base = blend(color, gradEnd, (uint8_t)(ratio * 255));
        float band = high;
        if (i < lowEnd) band = low;
        else if (i < midEnd) band = mid;
        uint8_t scale = (uint8_t)(60 + band * 195.0f);
        base.nscale8(scale);
        if (high > 0.65f && i >= midEnd) {
          base += CRGB(18, 24, 32);
        }
        leds[i] = base;
      }
      FastLED.setBrightness(b < 4 ? 4 : b);
    }
  }

  else if (pattern == "audio_comet") {
    // Existing comet with speed modulated by RMS
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    FastLED.setBrightness(bright);
    unsigned long ms = millis();
    float speed = 2000.0f;  // default 2s revolution
    if (g_audioFeatures.active) {
      // RMS modulates speed: louder = faster (2000ms down to 500ms)
      float rms = g_audioFeatures.rms;
      speed = 2000.0f - rms * 1500.0f;
      if (speed < 500.0f) speed = 500.0f;
    }
    float phase = fmodf((float)ms / speed, 1.0f);
    int head = (int)(phase * NUM_LEDS) % NUM_LEDS;

    int tailLen = 6;
    for (int i = 0; i <= tailLen; i++) {
      int idx = (head - i + NUM_LEDS) % NUM_LEDS;
      float fade = (i == 0) ? 1.0f : powf(0.45f, (float)i);
      CRGB c = color;
      c.nscale8((uint8_t)(fade * 255));
      leds[idx] = c;
    }
    // Bright white spark at the head
    CRGB spark = CRGB::White;
    spark.nscale8(96);
    leds[head] += spark;
  }

  // Mirror to onboard LED (same color/brightness as strip)
  onboardLed[0] = leds[0];

  // Rate-limit FastLED.show() during audio playback.
  // FASTLED_ALLOW_INTERRUPTS=0 blocks ALL interrupts for ~510µs per show().
  // At full loop speed (~200Hz) that's ~10% wall time with IRQs disabled.
  // Cap to 30fps during playback → ~1.5% IRQ-disabled time.
  extern volatile bool g_audioPlaying;
  static unsigned long s_lastShowMs = 0;
  const unsigned long showMinIntervalMs = g_audioPlaying ? 33UL : 0UL;
  const unsigned long nowMs = millis();
  if (showMinIntervalMs == 0 || (nowMs - s_lastShowMs) >= showMinIntervalMs) {
    FastLED.show();
    s_lastShowMs = nowMs;
  }
}

// ── Public API ───────────────────────────────────────────────
void ledInit() {
  // External strip on GPIO 5
  FastLED.addLeds<LED_TYPE, LED_PIN, COLOR_ORDER>(leds, NUM_LEDS)
    .setCorrection(TypicalLEDStrip);
  // Onboard RGB LED on GPIO 21 (Waveshare S3 Zero — uses RGB order, NOT GRB)
  FastLED.addLeds<WS2812B, ONBOARD_LED_PIN, RGB>(onboardLed, NUM_ONBOARD)
    .setCorrection(TypicalLEDStrip);

  // Aggressive clear: 3 rounds with delays to flush any stale RMT/DMA data
  // The first few LEDs in the chain are most susceptible to boot noise
  FastLED.setBrightness(0);
  memset(leds, 0, sizeof(leds));
  memset(onboardLed, 0, sizeof(onboardLed));
  FastLED.show();
  delay(30);
  FastLED.show();
  delay(30);
  FastLED.show();
  delay(30);

  // Now set real brightness
  FastLED.setBrightness(map(g_brightness, 0, 100, 0, MAX_BRIGHTNESS));
  Serial.println("[LED] Onboard LED on GPIO 21 + strip on GPIO 5");
}

void ledSetMode(LedMode mode) {
  g_ledMode = mode;
}

void ledNotify(const String& color, const String& pattern, unsigned long durationMs) {
  g_ledModeBeforeNotify = g_ledMode;  // remember what to restore
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
  prefs.putBool("idle_fs", g_ledIdleFullSpectrum);
  prefs.putBool("play_fs", g_ledPlayFullSpectrum);
  prefs.putBool("chrg_fs", g_ledChargeFullSpectrum);
  prefs.putInt("bright", g_brightness);
  prefs.putInt("volume", g_volume);
  prefs.putString("grad_e", g_ledGradEnd);
  prefs.putString("dcnp_cn", g_dcnpConcert);
  prefs.putString("dcnp_vd", g_dcnpVideo);
  prefs.putString("dcnp_mr", g_dcnpMerch);
  prefs.putString("dcnp_sg", g_dcnpSigning);
  prefs.putString("dcnp_rx", g_dcnpRemix);
  prefs.putString("dcnp_ot", g_dcnpOther);
  prefs.end();
  g_ledPersistDirty = false;
  Serial.println("[LED] Theme saved to NVS");
}

void ledMarkDirty() {
  g_ledPersistDirty = true;
}

void ledFlushIfDirty() {
  if (!g_ledPersistDirty) return;
  ledSaveToNVS();
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
  g_ledIdleFullSpectrum = prefs.getBool("idle_fs", g_ledIdleFullSpectrum);
  g_ledPlayFullSpectrum = prefs.getBool("play_fs", g_ledPlayFullSpectrum);
  g_ledChargeFullSpectrum = prefs.getBool("chrg_fs", g_ledChargeFullSpectrum);
  g_brightness  = prefs.getInt("bright", g_brightness);
  g_volume      = prefs.getInt("volume", g_volume);
  g_ledGradEnd  = prefs.getString("grad_e", g_ledGradEnd);
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
