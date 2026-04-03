/*
 * DPA Audio-Reactive LED System — audio_reactive.h
 * Real-time audio feature extraction for LED modulation
 *
 * Features extracted per audio buffer (in the audio conversion loop):
 *   - Peak L/R (absolute maximum sample value, 0.0–1.0)
 *   - RMS (root mean square energy, 0.0–1.0)
 *   - Envelope (smoothed peak with fast attack / slow release)
 *   - Bass energy (from EQ low-band filter state)
 *   - Beat flag (onset detection: peak > 2× moving average, 200ms lockout)
 *
 * Cross-core data flow:
 *   Core 1 (audio task): writes volatile AudioFeatures struct (28 bytes)
 *   Core 0 (main loop):  ledTick() reads AudioFeatures for LED modulation
 *   No mutex needed — LED tolerates stale-by-one-buffer values
 *
 * CPU budget: ~4-5 float ops per sample in the tight loop (well within
 * the 14-20 op headroom at 96kHz after EQ processing)
 *
 * RAM cost: 44 bytes (AudioFeatures struct + accumulators)
 */

#ifndef DPA_AUDIO_REACTIVE_H
#define DPA_AUDIO_REACTIVE_H

// ── Audio Features (written by Core 1, read by Core 0) ──────
struct AudioFeatures {
  volatile float peakL;       // 0.0–1.0, per-buffer peak left
  volatile float peakR;       // 0.0–1.0, per-buffer peak right
  volatile float rms;         // 0.0–1.0, per-buffer RMS energy
  volatile float envelope;    // 0.0–1.0, smoothed peak (fast attack, slow release)
  volatile float bassEnergy;  // 0.0–1.0, low-band energy from EQ state
  volatile bool  beatFlag;    // true for one buffer after beat onset
  volatile bool  active;      // true while audio is playing
};

// Global instance — written by audio task (core 1), read by LED (core 0)
AudioFeatures g_audioFeatures = {};

// ── Per-buffer accumulators (used inside audioConvertToStereo32) ──
static float g_accPeakL = 0.0f;
static float g_accPeakR = 0.0f;
static float g_accSumSq = 0.0f;
static uint32_t g_accFrameCount = 0;

// ── Beat detection state ──
static float g_beatAvg = 0.0f;        // moving average of peak
static unsigned long g_lastBeatMs = 0; // lockout timer
static const unsigned long BEAT_LOCKOUT_MS = 200;

// ── Envelope state ──
static float g_prevEnvelope = 0.0f;

// ── Bass energy from EQ (set by audio.h after eqApply) ──
static volatile float g_bassFilterOutput = 0.0f;
static inline void audioReactiveSetBass(float y1) {
  g_bassFilterOutput = y1;
}

// ── Call per-sample inside the conversion loop (after eqApply) ──
// This adds ~4-5 float ops per sample — well within budget
static inline void audioReactiveAccumulate(int32_t l, int32_t r) {
  float absL = fabsf((float)l / 2147483648.0f);
  float absR = fabsf((float)r / 2147483648.0f);
  if (absL > g_accPeakL) g_accPeakL = absL;
  if (absR > g_accPeakR) g_accPeakR = absR;
  g_accSumSq += absL * absL;  // mono RMS from left channel (good enough)
  g_accFrameCount++;
}

// ── Call once per buffer (after i2s_channel_write, outside tight loop) ──
// Computes final features from accumulated values
static void audioReactiveCompute() {
  if (g_accFrameCount == 0) return;

  float peakL = g_accPeakL;
  float peakR = g_accPeakR;
  float peak = (peakL > peakR) ? peakL : peakR;
  float rms = sqrtf(g_accSumSq / g_accFrameCount);

  // Envelope: fast attack (0.9), slow release (0.995)
  float env;
  if (peak > g_prevEnvelope) {
    env = peak * 0.9f + g_prevEnvelope * 0.1f;    // fast attack
  } else {
    env = peak * 0.005f + g_prevEnvelope * 0.995f; // slow release
  }
  g_prevEnvelope = env;

  // Bass energy: read cached EQ bass band filter output (set by audioReactiveSetBass)
  float bassRaw = fabsf(g_bassFilterOutput / 2147483648.0f);
  float bass = (bassRaw > 1.0f) ? 1.0f : bassRaw;

  // Beat detection: peak > 2× moving average, with lockout
  g_beatAvg = g_beatAvg * 0.95f + peak * 0.05f;  // slow moving average
  bool beat = false;
  unsigned long nowMs = millis();
  if (peak > g_beatAvg * 2.0f && peak > 0.05f &&
      (nowMs - g_lastBeatMs) > BEAT_LOCKOUT_MS) {
    beat = true;
    g_lastBeatMs = nowMs;
  }

  // Scale features by volume so VU meters reflect actual output level
  extern int g_volume;  // 0-100
  float volScale = g_volume / 100.0f;

  // Write to volatile struct (atomic-enough for LED reads on ESP32-S3)
  g_audioFeatures.peakL = peakL * volScale;
  g_audioFeatures.peakR = peakR * volScale;
  g_audioFeatures.rms = rms * volScale;
  g_audioFeatures.envelope = env * volScale;
  g_audioFeatures.bassEnergy = bass * volScale;
  g_audioFeatures.beatFlag = beat;
  g_audioFeatures.active = true;

  // Reset accumulators for next buffer
  g_accPeakL = 0.0f;
  g_accPeakR = 0.0f;
  g_accSumSq = 0.0f;
  g_accFrameCount = 0;
}

// ── Call when playback stops (reset features to zero) ──
static void audioReactiveReset() {
  g_audioFeatures.peakL = 0;
  g_audioFeatures.peakR = 0;
  g_audioFeatures.rms = 0;
  g_audioFeatures.envelope = 0;
  g_audioFeatures.bassEnergy = 0;
  g_audioFeatures.beatFlag = false;
  g_audioFeatures.active = false;
  g_prevEnvelope = 0;
  g_beatAvg = 0;
  g_accPeakL = 0;
  g_accPeakR = 0;
  g_accSumSq = 0;
  g_accFrameCount = 0;
}

#endif // DPA_AUDIO_REACTIVE_H
