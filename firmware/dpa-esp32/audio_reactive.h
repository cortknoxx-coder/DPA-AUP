/*
 * DPA Audio-Reactive LED System — audio_reactive.h
 * Real-time audio feature extraction for LED modulation
 *
 * Features extracted per audio buffer (in the audio conversion loop):
 *   - Peak L/R (absolute maximum sample value, 0.0–1.0)
 *   - RMS (root mean square energy, 0.0–1.0)
 *   - Envelope (smoothed peak with fast attack / slow release)
 *   - Bass energy (normalized low-band energy)
 *   - Beat flag (onset detection: peak > 2× moving average, 200ms lockout)
 *
 * Cross-core data flow:
 *   Core 1 (audio task): writes volatile AudioFeatures struct (28 bytes)
 *   Core 0 (main loop):  ledTick() reads AudioFeatures for LED modulation
 *   No mutex needed — LED tolerates stale-by-one-buffer values
 *
 * CPU budget: lightweight one-pole analysis with per-buffer normalization.
 * The analysis path tracks low/mid/high band energy without changing the
 * public API surface consumed by the dashboard and LED engine.
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
static float g_accLowSq = 0.0f;
static float g_accMidSq = 0.0f;
static float g_accHighSq = 0.0f;
static uint32_t g_accFrameCount = 0;

// ── Beat detection state ──
static float g_beatAvg = 0.0f;        // moving average of peak
static unsigned long g_lastBeatMs = 0; // lockout timer
static const unsigned long BEAT_LOCKOUT_MS = 200;

// ── Envelope state ──
static float g_prevEnvelope = 0.0f;

// ── 3-band analysis state ──
static float g_prevLowEnv = 0.0f;
static float g_prevMidEnv = 0.0f;
static float g_prevHighEnv = 0.0f;
static float g_lowCeiling = 0.15f;
static float g_midCeiling = 0.15f;
static float g_highCeiling = 0.15f;
static float g_lowBandLevel = 0.0f;
static float g_midBandLevel = 0.0f;
static float g_highBandLevel = 0.0f;

// One-pole split: low-pass at 180Hz, high-pass at 2.5kHz.
static float g_lowpassState = 0.0f;
static float g_highpassState = 0.0f;
static float g_highpassPrevInput = 0.0f;
static float g_lowpassAlpha = 0.0f;
static float g_highpassAlpha = 0.0f;

static inline float audioReactiveClamp01(float v) {
  if (v < 0.0f) return 0.0f;
  if (v > 1.0f) return 1.0f;
  return v;
}

static inline float audioReactiveFastAttackSlowRelease(float current, float previous) {
  return (current > previous)
    ? (current * 0.9f + previous * 0.1f)
    : (current * 0.005f + previous * 0.995f);
}

static inline float audioReactiveNormalizeBand(float env, float* ceiling) {
  *ceiling = fmaxf(env, (*ceiling) * 0.9975f);
  if (*ceiling < 0.02f) *ceiling = 0.02f;
  return audioReactiveClamp01(env / (*ceiling + 0.0001f));
}

static void audioReactiveConfigure(uint32_t sampleRate) {
  if (sampleRate == 0) sampleRate = 44100;
  const float dt = 1.0f / (float)sampleRate;

  const float lowRc = 1.0f / (2.0f * PI * 180.0f);
  g_lowpassAlpha = dt / (lowRc + dt);

  const float highRc = 1.0f / (2.0f * PI * 2500.0f);
  g_highpassAlpha = highRc / (highRc + dt);
}

static inline float audioReactiveLowBandLevel() { return g_lowBandLevel; }
static inline float audioReactiveMidBandLevel() { return g_midBandLevel; }
static inline float audioReactiveHighBandLevel() { return g_highBandLevel; }

// ── Call per-sample inside the conversion loop after DSP/output shaping ──
static inline void audioReactiveAccumulate(int32_t l, int32_t r) {
  float normL = (float)l / 2147483648.0f;
  float normR = (float)r / 2147483648.0f;
  float absL = fabsf(normL);
  float absR = fabsf(normR);
  if (absL > g_accPeakL) g_accPeakL = absL;
  if (absR > g_accPeakR) g_accPeakR = absR;
  float mono = 0.5f * (normL + normR);
  g_accSumSq += mono * mono;

  g_lowpassState += g_lowpassAlpha * (mono - g_lowpassState);
  const float low = g_lowpassState;

  const float high = g_highpassAlpha * (g_highpassState + mono - g_highpassPrevInput);
  g_highpassState = high;
  g_highpassPrevInput = mono;

  const float mid = mono - low - high;
  g_accLowSq += low * low;
  g_accMidSq += mid * mid;
  g_accHighSq += high * high;
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
  float low = sqrtf(g_accLowSq / g_accFrameCount);
  float mid = sqrtf(g_accMidSq / g_accFrameCount);
  float high = sqrtf(g_accHighSq / g_accFrameCount);

  float env = audioReactiveFastAttackSlowRelease(peak, g_prevEnvelope);
  g_prevEnvelope = env;

  float lowEnv = audioReactiveFastAttackSlowRelease(low, g_prevLowEnv);
  float midEnv = audioReactiveFastAttackSlowRelease(mid, g_prevMidEnv);
  float highEnv = audioReactiveFastAttackSlowRelease(high, g_prevHighEnv);
  g_prevLowEnv = lowEnv;
  g_prevMidEnv = midEnv;
  g_prevHighEnv = highEnv;

  float lowNorm = audioReactiveNormalizeBand(lowEnv, &g_lowCeiling);
  float midNorm = audioReactiveNormalizeBand(midEnv, &g_midCeiling);
  float highNorm = audioReactiveNormalizeBand(highEnv, &g_highCeiling);
  g_lowBandLevel = lowNorm;
  g_midBandLevel = midNorm;
  g_highBandLevel = highNorm;

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
  g_audioFeatures.bassEnergy = lowNorm * volScale;
  g_audioFeatures.beatFlag = beat;
  g_audioFeatures.active = true;

  // Reset accumulators for next buffer
  g_accPeakL = 0.0f;
  g_accPeakR = 0.0f;
  g_accSumSq = 0.0f;
  g_accLowSq = 0.0f;
  g_accMidSq = 0.0f;
  g_accHighSq = 0.0f;
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
  g_prevLowEnv = 0;
  g_prevMidEnv = 0;
  g_prevHighEnv = 0;
  g_beatAvg = 0;
  g_accPeakL = 0;
  g_accPeakR = 0;
  g_accSumSq = 0;
  g_accLowSq = 0;
  g_accMidSq = 0;
  g_accHighSq = 0;
  g_accFrameCount = 0;
  g_lowBandLevel = 0;
  g_midBandLevel = 0;
  g_highBandLevel = 0;
  g_lowCeiling = 0.15f;
  g_midCeiling = 0.15f;
  g_highCeiling = 0.15f;
  g_lowpassState = 0;
  g_highpassState = 0;
  g_highpassPrevInput = 0;
}

#endif // DPA_AUDIO_REACTIVE_H
