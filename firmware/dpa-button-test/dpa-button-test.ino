/*
 * DPA Button Test — 4 Buttons
 * ----------------------------
 * Waveshare ESP32-S3 Zero
 *
 * Wiring:
 *   Each button: one leg to GPIO, other leg to GND
 *   Internal pull-ups used — no external resistors needed
 *
 * Button map:
 *   GP1  = PLAY / PAUSE  (toggle)
 *   GP2  = NEXT TRACK
 *   GP3  = PREV TRACK
 *   GP4  = HEART / FAVORITE
 *
 * LED feedback:
 *   Onboard WS2812B (GP21) + external strip (GP5, 17 LEDs)
 *
 *   PLAY  → green flash, stays green while "playing"
 *   PAUSE → amber flash, back to idle purple breathe
 *   NEXT  → blue sweep right →
 *   PREV  → blue sweep left ←
 *   HEART → red pulse (heartbeat effect)
 */

#include <FastLED.h>

#define LED_PIN          5
#define NUM_LEDS         17
#define ONBOARD_LED_PIN  21

// Button GPIOs
#define BTN_PLAY   1
#define BTN_NEXT   2
#define BTN_PREV   3
#define BTN_HEART  4

#define NUM_BUTTONS 4
#define DEBOUNCE_MS 50

CRGB leds[NUM_LEDS];
CRGB onboardLed[1];

struct Button {
  uint8_t pin;
  const char* name;
  bool lastState;
  bool pressed;
  uint32_t lastDebounce;
};

Button buttons[NUM_BUTTONS] = {
  { BTN_PLAY,  "PLAY/PAUSE (GP1)", HIGH, false, 0 },
  { BTN_NEXT,  "NEXT (GP2)",       HIGH, false, 0 },
  { BTN_PREV,  "PREV (GP3)",       HIGH, false, 0 },
  { BTN_HEART, "HEART (GP4)",      HIGH, false, 0 },
};

uint32_t pressCount[NUM_BUTTONS] = {0};

// Simulated state
bool simPlaying = false;
int  simTrackIndex = 0;
int  simTotalTracks = 5;
bool simFavorited[10] = {false};  // track favorites

// LED animation state
uint32_t animStart = 0;
enum AnimType { ANIM_NONE, ANIM_SWEEP_RIGHT, ANIM_SWEEP_LEFT, ANIM_HEARTBEAT };
AnimType currentAnim = ANIM_NONE;

// ── LED Helpers ──────────────────────────────────────────────

void setAllLeds(const CRGB& color) {
  fill_solid(leds, NUM_LEDS, color);
  onboardLed[0] = color;
  FastLED.show();
}

// Idle breathe — purple when stopped, green when playing
void breatheIdle() {
  static uint8_t val = 30;
  static int8_t delta = 3;
  static uint32_t last = 0;
  if (millis() - last < 25) return;
  last = millis();

  val += delta;
  if (val >= 180) delta = -3;
  if (val <= 10)  delta = 3;

  CRGB base = simPlaying ? CRGB::Green : CRGB::Purple;
  CRGB c = base;
  c.nscale8(val);
  fill_solid(leds, NUM_LEDS, c);
  onboardLed[0] = c;
  FastLED.show();
}

// Sweep animation right (NEXT) or left (PREV)
void animSweep(bool goRight) {
  CRGB color = CRGB::Blue;
  for (int i = 0; i < NUM_LEDS; i++) {
    int idx = goRight ? i : (NUM_LEDS - 1 - i);
    leds[idx] = color;
    onboardLed[0] = color;
    FastLED.show();
    delay(15);
    leds[idx].nscale8(60);
  }
  // Fade out
  for (int fade = 0; fade < 8; fade++) {
    for (int i = 0; i < NUM_LEDS; i++) leds[i].nscale8(140);
    onboardLed[0].nscale8(140);
    FastLED.show();
    delay(20);
  }
}

// Heartbeat pulse — two quick red pulses like a real heartbeat
void animHeartbeat() {
  CRGB heartColor = CRGB(255, 0, 40);  // deep red-pink

  for (int pulse = 0; pulse < 2; pulse++) {
    // Pulse up
    for (int b = 0; b <= 255; b += 15) {
      CRGB c = heartColor;
      c.nscale8(b);
      fill_solid(leds, NUM_LEDS, c);
      onboardLed[0] = c;
      FastLED.show();
      delay(8);
    }
    // Pulse down
    for (int b = 255; b >= 0; b -= 15) {
      CRGB c = heartColor;
      c.nscale8(b);
      fill_solid(leds, NUM_LEDS, c);
      onboardLed[0] = c;
      FastLED.show();
      delay(8);
    }
    // Short gap between the two beats
    if (pulse == 0) delay(80);
  }
}

// Green flash for play
void animPlayFlash() {
  setAllLeds(CRGB::Green);
  delay(150);
}

// Amber flash for pause
void animPauseFlash() {
  setAllLeds(CRGB(255, 160, 0));  // amber
  delay(150);
  setAllLeds(CRGB::Black);
  delay(100);
}

// ── Button Actions ───────────────────────────────────────────

void onPlayPause() {
  simPlaying = !simPlaying;

  if (simPlaying) {
    Serial.printf("  ▶ PLAY — Track %d of %d\n", simTrackIndex + 1, simTotalTracks);
    animPlayFlash();
  } else {
    Serial.printf("  ⏸ PAUSE — Track %d of %d\n", simTrackIndex + 1, simTotalTracks);
    animPauseFlash();
  }
}

void onNext() {
  simTrackIndex = (simTrackIndex + 1) % simTotalTracks;
  Serial.printf("  ⏭ NEXT → Track %d of %d\n", simTrackIndex + 1, simTotalTracks);
  animSweep(true);
}

void onPrev() {
  simTrackIndex = (simTrackIndex - 1 + simTotalTracks) % simTotalTracks;
  Serial.printf("  ⏮ PREV → Track %d of %d\n", simTrackIndex + 1, simTotalTracks);
  animSweep(false);
}

void onHeart() {
  simFavorited[simTrackIndex] = !simFavorited[simTrackIndex];
  bool fav = simFavorited[simTrackIndex];

  if (fav) {
    Serial.printf("  ❤️  FAVORITED Track %d\n", simTrackIndex + 1);
  } else {
    Serial.printf("  🤍 UNFAVORITED Track %d\n", simTrackIndex + 1);
  }

  animHeartbeat();

  // Quick summary
  Serial.print("  Favorites: [");
  for (int i = 0; i < simTotalTracks; i++) {
    Serial.printf(" %s%d", simFavorited[i] ? "♥" : "·", i + 1);
  }
  Serial.println(" ]");
}

// ── Setup ────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(2000);

  Serial.println();
  Serial.println("╔══════════════════════════════════════╗");
  Serial.println("║  DPA Button Test — 4 Buttons         ║");
  Serial.println("║  GP1=Play  GP2=Next  GP3=Prev        ║");
  Serial.println("║  GP4=Heart                            ║");
  Serial.println("╚══════════════════════════════════════╝");
  Serial.println();

  // Init LEDs
  FastLED.addLeds<WS2812B, LED_PIN, GRB>(leds, NUM_LEDS);
  FastLED.addLeds<WS2812B, ONBOARD_LED_PIN, RGB>(onboardLed, 1);
  FastLED.setBrightness(50);

  // Init buttons with internal pull-up
  for (int i = 0; i < NUM_BUTTONS; i++) {
    pinMode(buttons[i].pin, INPUT_PULLUP);
    Serial.printf("  [OK] %s ready\n", buttons[i].name);
  }

  Serial.println();
  Serial.println("Simulating 5 tracks. Press buttons to test.");
  Serial.printf("Current: Track %d | Playing: %s\n\n",
                simTrackIndex + 1, simPlaying ? "YES" : "NO");

  // Startup — purple breathe
  setAllLeds(CRGB::Purple);
  delay(500);
  setAllLeds(CRGB::Black);
}

// ── Loop ─────────────────────────────────────────────────────

void loop() {
  bool anyAction = false;

  for (int i = 0; i < NUM_BUTTONS; i++) {
    bool reading = digitalRead(buttons[i].pin);

    if (reading != buttons[i].lastState) {
      buttons[i].lastDebounce = millis();
      buttons[i].lastState = reading;
    }

    if ((millis() - buttons[i].lastDebounce) > DEBOUNCE_MS) {
      // Button pressed (active LOW, momentary)
      if (reading == LOW && !buttons[i].pressed) {
        buttons[i].pressed = true;
        pressCount[i]++;
        anyAction = true;

        Serial.printf("\n[BTN] %s pressed (#%lu)\n",
                      buttons[i].name, (unsigned long)pressCount[i]);

        switch (buttons[i].pin) {
          case BTN_PLAY:  onPlayPause(); break;
          case BTN_NEXT:  onNext();      break;
          case BTN_PREV:  onPrev();      break;
          case BTN_HEART: onHeart();     break;
        }

        // Status line after every action
        Serial.printf("  Status: Track %d/%d | %s | %s\n",
                      simTrackIndex + 1, simTotalTracks,
                      simPlaying ? "PLAYING" : "PAUSED",
                      simFavorited[simTrackIndex] ? "♥ Fav" : "· Not fav");
      }

      // Button released
      if (reading == HIGH && buttons[i].pressed) {
        buttons[i].pressed = false;
      }
    }
  }

  // Idle LED animation when no button action
  if (!anyAction) {
    breatheIdle();
  }

  delay(2);
}
