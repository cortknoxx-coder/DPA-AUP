/*
 * DPA Audio Engine — audio.h
 * I2S output to Adafruit PCM5122 DAC via legacy ESP-IDF I2S driver
 * WAV file playback from SD card using FreeRTOS task on core 1
 *
 * Wiring:
 *   DAC BCK  → GP6  (Bit Clock)
 *   DAC WSEL → GP7  (Word Select / LRCLK)
 *   DAC DIN  → GP8  (Serial Data)
 *   DAC MCK  → not connected (PCM5122 generates internally)
 *   DAC MUTE → not connected (defaults to unmuted)
 *   VIN      → 3V3
 *   GND      → GND (shared)
 *   Audio out → 3.5mm jack on DAC module
 *
 * CRITICAL: ws_inv = true on PCM5122 — required for correct audio output
 *
 * Supported WAV formats:
 *   - PCM 16-bit mono/stereo
 *   - PCM 24-bit packed mono/stereo
 *   - PCM 24-bit in 32-bit container mono/stereo
 *   - PCM 32-bit mono/stereo
 *
 * All formats are converted to 32-bit stereo for I2S output.
 * Playback runs on a FreeRTOS task pinned to core 1.
 * 16KB read buffer + carry buffer for block alignment.
 */

#ifndef DPA_AUDIO_H
#define DPA_AUDIO_H

#include <driver/i2s.h>
#include <esp_heap_caps.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

extern int g_volume;
extern String g_eq;
#include <SD.h>
#include "dpa_format.h"
#include "audio_reactive.h"  // Audio feature extraction for LED reactivity

static constexpr uint32_t kAudioPlaybackTaskStackBytes = 12 * 1024;
static constexpr uint32_t kAudioRestartSettleMs = 100;
static constexpr size_t kAudioPendingPathMaxLen = 192;
static constexpr UBaseType_t kAudioTaskPriority = configMAX_PRIORITIES - 2;
static String g_audioTracksJsonCache = "";
static bool g_audioTracksJsonDirty = true;

// ── Software EQ (3-band biquad) ─────────────────────────────
// Each band is a second-order IIR biquad filter applied per-channel.
// Coefficients computed from Audio EQ Cookbook (Robert Bristow-Johnson).
// Runs in the sample conversion loop — negligible CPU at any sample rate.

struct BiquadCoeffs {
  float b0, b1, b2, a1, a2;  // normalized (a0 = 1.0)
};

struct BiquadState {
  float x1, x2, y1, y2;      // delay line per channel
};

#define EQ_NUM_BANDS 3  // bass, mid, treble

// Per-channel state for 3 bands
static BiquadState g_eqStateL[EQ_NUM_BANDS] = {};
static BiquadState g_eqStateR[EQ_NUM_BANDS] = {};
static BiquadCoeffs g_eqCoeffs[EQ_NUM_BANDS] = {};
static bool g_eqEnabled = false;
static String g_eqCurrent = "flat";  // tracks which preset is active

// Apply a single biquad filter to one sample
static inline float biquadProcess(BiquadState& s, const BiquadCoeffs& c, float x) {
  float y = c.b0 * x + c.b1 * s.x1 + c.b2 * s.x2 - c.a1 * s.y1 - c.a2 * s.y2;
  s.x2 = s.x1; s.x1 = x;
  s.y2 = s.y1; s.y1 = y;
  return y;
}

// Compute peaking EQ biquad coefficients
static void eqPeakingEQ(BiquadCoeffs& c, float sampleRate, float freq, float Q, float gainDB) {
  float A = powf(10.0f, gainDB / 40.0f);
  float w0 = 2.0f * PI * freq / sampleRate;
  float alpha = sinf(w0) / (2.0f * Q);
  float a0 = 1.0f + alpha / A;
  c.b0 = (1.0f + alpha * A) / a0;
  c.b1 = (-2.0f * cosf(w0)) / a0;
  c.b2 = (1.0f - alpha * A) / a0;
  c.a1 = (-2.0f * cosf(w0)) / a0;
  c.a2 = (1.0f - alpha / A) / a0;
}

// Compute low-shelf biquad coefficients
static void eqLowShelf(BiquadCoeffs& c, float sampleRate, float freq, float Q, float gainDB) {
  float A = powf(10.0f, gainDB / 40.0f);
  float w0 = 2.0f * PI * freq / sampleRate;
  float alpha = sinf(w0) / (2.0f * Q);
  float sqrtA = sqrtf(A);
  float a0 = (A + 1.0f) + (A - 1.0f) * cosf(w0) + 2.0f * sqrtA * alpha;
  c.b0 = (A * ((A + 1.0f) - (A - 1.0f) * cosf(w0) + 2.0f * sqrtA * alpha)) / a0;
  c.b1 = (2.0f * A * ((A - 1.0f) - (A + 1.0f) * cosf(w0))) / a0;
  c.b2 = (A * ((A + 1.0f) - (A - 1.0f) * cosf(w0) - 2.0f * sqrtA * alpha)) / a0;
  c.a1 = (-2.0f * ((A - 1.0f) + (A + 1.0f) * cosf(w0))) / a0;
  c.a2 = ((A + 1.0f) + (A - 1.0f) * cosf(w0) - 2.0f * sqrtA * alpha) / a0;
}

// Compute high-shelf biquad coefficients
static void eqHighShelf(BiquadCoeffs& c, float sampleRate, float freq, float Q, float gainDB) {
  float A = powf(10.0f, gainDB / 40.0f);
  float w0 = 2.0f * PI * freq / sampleRate;
  float alpha = sinf(w0) / (2.0f * Q);
  float sqrtA = sqrtf(A);
  float a0 = (A + 1.0f) - (A - 1.0f) * cosf(w0) + 2.0f * sqrtA * alpha;
  c.b0 = (A * ((A + 1.0f) + (A - 1.0f) * cosf(w0) + 2.0f * sqrtA * alpha)) / a0;
  c.b1 = (-2.0f * A * ((A - 1.0f) + (A + 1.0f) * cosf(w0))) / a0;
  c.b2 = (A * ((A + 1.0f) + (A - 1.0f) * cosf(w0) - 2.0f * sqrtA * alpha)) / a0;
  c.a1 = (2.0f * ((A - 1.0f) - (A + 1.0f) * cosf(w0))) / a0;
  c.a2 = ((A + 1.0f) - (A - 1.0f) * cosf(w0) - 2.0f * sqrtA * alpha) / a0;
}

// Reset filter delay lines (call on track change to avoid pops)
static void eqResetState() {
  memset(g_eqStateL, 0, sizeof(g_eqStateL));
  memset(g_eqStateR, 0, sizeof(g_eqStateR));
}

// ── Pre-gain compensation (prevents clipping on boost) ──────
// EBU R128 mandates -1 dBTP headroom. We subtract the max boost + 1dB.
static float g_eqPreGain = 1.0f;  // linear multiplier applied before filters

// Set EQ preset — computes coefficients for current sample rate
// Band 0: Low shelf (200Hz), Band 1: Peaking (1kHz), Band 2: High shelf (3.5kHz)
// All gains based on industry standards (EBU R128, ITU-R BS.1770, ISO 226:2003)
// Max boost ≤4dB with pre-gain compensation to prevent clipping on mastered audio.
void eqSetPreset(const String& preset, uint32_t sampleRate) {
  if (sampleRate == 0) sampleRate = 44100;
  eqResetState();
  g_eqCurrent = preset;

  if (preset == "flat" || preset == "") {
    g_eqEnabled = false;
    g_eqPreGain = 1.0f;
    return;
  }
  g_eqEnabled = true;

  // Preset: {bassFreq, bassGain_dB, midFreq, midQ, midGain_dB, trebleFreq, trebleGain_dB}
  // Q=0.707 = Butterworth (maximally flat shelves, ~2-octave parametric width)
  float bF=200, bG=0, mF=1000, mQ=0.707f, mG=0, tF=3500, tG=0;

  if (preset == "bass_boost") {
    // Low-end emphasis, slight mid scoop to reduce mud. Refs: Spotify Bass Booster
    bF=200;  bG=+3.5f;   mF=800;  mQ=0.8f;  mG=-1.0f;   tF=3500; tG=0.0f;
  } else if (preset == "vocal") {
    // Presence boost (800Hz-3kHz vocal range), low cut for clarity, air shelf
    bF=200;  bG=-1.5f;   mF=1000; mQ=0.707f; mG=+2.5f;  tF=3500; tG=+1.5f;
  } else if (preset == "warm") {
    // Low-mid body, gentle presence dip, treble rolloff. Classic "warm" curve
    bF=200;  bG=+3.0f;   mF=1000; mQ=0.707f; mG=-0.5f;  tF=3500; tG=-2.0f;
  } else if (preset == "bright") {
    // Air and presence lift, slight bass reduction. Open/airy sound
    bF=200;  bG=-0.5f;   mF=1000; mQ=1.0f;   mG=+1.0f;  tF=3500; tG=+3.5f;
  } else if (preset == "loudness") {
    // Fletcher-Munson compensation for low-volume listening (ISO 226:2003)
    // Boost bass + treble extremes where ear is least sensitive at low SPL
    bF=200;  bG=+3.5f;   mF=1000; mQ=0.707f; mG=-1.0f;  tF=3500; tG=+2.5f;
  } else if (preset == "r_and_b") {
    // Warm bass with smooth presence. Sub-bass emphasis, recessed upper-mids
    bF=200;  bG=+3.0f;   mF=1000; mQ=0.707f; mG=-1.5f;  tF=3500; tG=+1.0f;
  } else if (preset == "electronic") {
    // Sub-bass heavy, scooped mids, crisp highs. Standard EDM curve
    bF=200;  bG=+4.0f;   mF=1000; mQ=0.707f; mG=-2.0f;  tF=3500; tG=+2.5f;
  } else if (preset == "late_night") {
    // Reduced dynamics: boost mids (ear-sensitive range), cut extremes
    // Simulates loudness normalization for quiet listening
    bF=200;  bG=-2.0f;   mF=1000; mQ=0.707f; mG=+2.0f;  tF=3500; tG=-1.5f;
  } else {
    g_eqEnabled = false;
    g_eqPreGain = 1.0f;
    return;
  }

  // Compute pre-gain: attenuate by max boost + 1dB headroom (EBU R128: -1 dBTP)
  float maxBoost = fmaxf(0.0f, fmaxf(bG, fmaxf(mG, tG)));
  float preGainDB = -(maxBoost + 1.0f);
  g_eqPreGain = powf(10.0f, preGainDB / 20.0f);  // dB to linear

  eqLowShelf(g_eqCoeffs[0], sampleRate, bF, 0.707f, bG);
  eqPeakingEQ(g_eqCoeffs[1], sampleRate, mF, mQ, mG);
  eqHighShelf(g_eqCoeffs[2], sampleRate, tF, 0.707f, tG);

  Serial.printf("[EQ] Preset '%s' @ %luHz | preGain=%.1fdB (%.3f)\n",
    preset.c_str(), (unsigned long)sampleRate, preGainDB, g_eqPreGain);
  Serial.printf("[EQ] Bass: %.1fdB@%dHz | Mid: %.1fdB@%dHz Q%.2f | Treble: %.1fdB@%dHz\n",
    bG, (int)bF, mG, (int)mF, mQ, tG, (int)tF);
}

// Set custom EQ from user mixer sliders (bass/mid/treble in dB, clamped ±6)
void eqSetCustom(float bassDB, float midDB, float trebleDB, uint32_t sampleRate) {
  if (sampleRate == 0) sampleRate = 44100;
  eqResetState();
  g_eqCurrent = "custom";

  // Clamp to safe range
  bassDB = fmaxf(-6.0f, fminf(6.0f, bassDB));
  midDB = fmaxf(-6.0f, fminf(6.0f, midDB));
  trebleDB = fmaxf(-6.0f, fminf(6.0f, trebleDB));

  // Check if flat
  if (fabsf(bassDB) < 0.1f && fabsf(midDB) < 0.1f && fabsf(trebleDB) < 0.1f) {
    g_eqEnabled = false;
    g_eqPreGain = 1.0f;
    return;
  }
  g_eqEnabled = true;

  // Pre-gain compensation
  float maxBoost = fmaxf(0.0f, fmaxf(bassDB, fmaxf(midDB, trebleDB)));
  float preGainDB = -(maxBoost + 1.0f);
  g_eqPreGain = powf(10.0f, preGainDB / 20.0f);

  // Standard crossover: 200Hz low shelf, 1kHz parametric, 3.5kHz high shelf
  eqLowShelf(g_eqCoeffs[0], sampleRate, 200.0f, 0.707f, bassDB);
  eqPeakingEQ(g_eqCoeffs[1], sampleRate, 1000.0f, 0.707f, midDB);
  eqHighShelf(g_eqCoeffs[2], sampleRate, 3500.0f, 0.707f, trebleDB);

  Serial.printf("[EQ] Custom @ %luHz | bass=%.1f mid=%.1f treble=%.1f preGain=%.1fdB\n",
    (unsigned long)sampleRate, bassDB, midDB, trebleDB, preGainDB);
}

// Apply EQ to a stereo sample pair (in-place, 32-bit fixed point)
// Pre-gain → 3-band biquad → soft-clip limiter
static inline void eqApply(int32_t& lSample, int32_t& rSample) {
  if (!g_eqEnabled) return;
  // Convert to float and apply pre-gain (headroom reduction before boost)
  float lf = (float)lSample * g_eqPreGain;
  float rf = (float)rSample * g_eqPreGain;
  // 3-band biquad filter chain
  for (int b = 0; b < EQ_NUM_BANDS; b++) {
    lf = biquadProcess(g_eqStateL[b], g_eqCoeffs[b], lf);
    rf = biquadProcess(g_eqStateR[b], g_eqCoeffs[b], rf);
  }
  // Soft-clip limiter (tanh-style) — prevents harsh digital clipping
  const float ceiling = 2147483647.0f;
  if (lf > ceiling * 0.9f || lf < -ceiling * 0.9f) {
    lf = tanhf(lf / ceiling) * ceiling;  // smooth saturation above 90%
  }
  if (rf > ceiling * 0.9f || rf < -ceiling * 0.9f) {
    rf = tanhf(rf / ceiling) * ceiling;
  }
  lSample = (int32_t)lf;
  rSample = (int32_t)rf;
}

// ── I2S Pin Config ──────────────────────────────────────────
#define I2S_BCK_PIN   6    // Bit clock
#define I2S_WS_PIN    7    // Word select (LRCLK/WSEL)
#define I2S_DOUT_PIN  8    // Serial data out to DAC

// ── Audio State ─────────────────────────────────────────────
static bool g_i2sInstalled = false;
bool   g_audioReady    = false;

// Playback state (volatile for cross-task access)
volatile bool g_audioPlaying = false;
volatile bool g_audioStopRequested = false;
volatile bool g_audioSeekRequested = false;
volatile uint32_t g_audioSeekToMs = 0;
String g_audioFile     = "";
String g_audioNowPlaying = "";

// Playback task handle
static TaskHandle_t g_playbackTaskHandle = nullptr;
static portMUX_TYPE g_audioRequestMux = portMUX_INITIALIZER_UNLOCKED;
static char g_audioPendingPath[kAudioPendingPathMaxLen] = {};

// WAV header info (read-only after parse, used by API for position reporting)
static uint16_t g_wavChannels     = 0;
static uint32_t g_wavSampleRate   = 0;
static uint16_t g_wavBitsPerSample = 0;
static uint16_t g_wavBlockAlign   = 0;
static uint32_t g_wavDataSize     = 0;
static uint32_t g_wavDataOffset   = 0;
volatile uint32_t g_wavBytesRead  = 0;

// ── Forward Declarations ─────────────────────────────────────
void audioStop();
static bool audioEnsurePlaybackWorker();

static void audioStorePendingPath(const char* path) {
  taskENTER_CRITICAL(&g_audioRequestMux);
  size_t i = 0;
  if (path) {
    for (; i + 1 < sizeof(g_audioPendingPath) && path[i] != '\0'; ++i) {
      g_audioPendingPath[i] = path[i];
    }
  }
  g_audioPendingPath[i] = '\0';
  taskEXIT_CRITICAL(&g_audioRequestMux);
}

static void audioLoadPendingPath(char* out, size_t outSize) {
  if (!out || outSize == 0) return;
  taskENTER_CRITICAL(&g_audioRequestMux);
  size_t i = 0;
  for (; i + 1 < outSize && i < sizeof(g_audioPendingPath) && g_audioPendingPath[i] != '\0'; ++i) {
    out[i] = g_audioPendingPath[i];
  }
  out[i] = '\0';
  taskEXIT_CRITICAL(&g_audioRequestMux);
}

// ── Playable PCM Info Struct ────────────────────────────────
// Shared by raw WAV files and DPA1-wrapped WAV payloads.
struct WavInfo {
  uint16_t audioFormat;
  uint32_t sampleRate;
  uint16_t bitsPerSample;
  uint16_t channels;
  uint16_t blockAlign;
  uint32_t dataOffset;
  uint32_t dataSize;
  bool isDpa;
  String format;
  String title;
  bool valid;
};

// ── Playback Buffers (static, used only by playback task) ───
// 32KB read buffer — reduces SD transactions, critical for 96kHz/24-bit
static uint8_t  g_audioInBuf[32768];
static uint8_t  g_audioCarryBuf[16];
static size_t   g_audioCarryLen = 0;
// Output buffer: 32KB input of 24-bit stereo (5461 frames) → 5461×8 = ~44KB
// Sized to 11264 entries (5632 stereo frames × 2 channels × 4 bytes = 45056 bytes)
static int32_t  g_audioOutBuf[11264];

// ── WAV Parser Helpers ──────────────────────────────────────
static uint16_t audioRd16(File& f) {
  uint8_t b[2] = {0, 0};
  if (f.read(b, 2) != 2) return 0;
  return (uint16_t)(b[0] | (b[1] << 8));
}

static uint32_t audioRd32(File& f) {
  uint8_t b[4] = {0, 0, 0, 0};
  if (f.read(b, 4) != 4) return 0;
  return (uint32_t)(b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24));
}

// ── Parse WAV Header (robust chunk-based parser) ────────────
static WavInfo audioParseWavAt(File& f, uint32_t startOffset) {
  WavInfo info = {0, 0, 0, 0, 0, 0, 0, false, "wav", "", false};
  char id[5] = {0};

  f.seek(startOffset);

  if (f.read((uint8_t*)id, 4) != 4) return info;
  if (memcmp(id, "RIFF", 4) != 0) return info;

  audioRd32(f); // file size

  memset(id, 0, sizeof(id));
  if (f.read((uint8_t*)id, 4) != 4) return info;
  if (memcmp(id, "WAVE", 4) != 0) return info;

  bool gotFmt = false;
  bool gotData = false;

  while (f.available()) {
    memset(id, 0, sizeof(id));
    if (f.read((uint8_t*)id, 4) != 4) break;
    uint32_t chunkSize = audioRd32(f);
    if (memcmp(id, "fmt ", 4) == 0) {
      info.audioFormat   = audioRd16(f);
      info.channels      = audioRd16(f);
      info.sampleRate    = audioRd32(f);
      audioRd32(f); // byte rate
      info.blockAlign    = audioRd16(f);
      info.bitsPerSample = audioRd16(f);

      if (chunkSize > 16) {
        f.seek(f.position() + (chunkSize - 16));
      }

      if (info.audioFormat == 1 || info.audioFormat == 3) gotFmt = true;  // 1=PCM int, 3=IEEE float
    } else if (memcmp(id, "data", 4) == 0) {
      info.dataOffset = f.position();
      info.dataSize = chunkSize;
      f.seek(f.position() + chunkSize);
      gotData = true;
    } else {
      f.seek(f.position() + chunkSize);
    }

    if (gotFmt && gotData) break;
  }

  bool supportedBits = (info.bitsPerSample == 16 || info.bitsPerSample == 24 || info.bitsPerSample == 32);
  bool supportedCh   = (info.channels == 1 || info.channels == 2);

  if (gotFmt && gotData && supportedBits && supportedCh && info.blockAlign > 0) {
    info.valid = true;
  }

  return info;
}

static WavInfo audioParseWav(File& f) {
  return audioParseWavAt(f, 0);
}

static WavInfo audioParseDpa(File& f) {
  WavInfo info = {0, 0, 0, 0, 0, 0, 0, false, "dpa", "", false};
  DpaFileHeader header;
  if (!dpaReadHeader(f, header) || !header.valid) return info;
  if (header.payloadFormat != DPA_PAYLOAD_WAV) return info;

  WavInfo embedded = audioParseWavAt(f, dpaPayloadOffset(header));
  if (!embedded.valid) return info;

  embedded.isDpa = true;
  embedded.format = "dpa";
  embedded.title = header.title;
  return embedded;
}

static WavInfo audioParsePlayable(File& f, const String& path) {
  if (path.endsWith(".dpa") || path.endsWith(".DPA")) {
    return audioParseDpa(f);
  }
  return audioParseWav(f);
}

// ── I2S Init / Shutdown ─────────────────────────────────────
static void audioShutdownI2S() {
  if (g_i2sInstalled) {
    i2s_zero_dma_buffer(I2S_NUM_0);
    i2s_driver_uninstall(I2S_NUM_0);
    g_i2sInstalled = false;
  }
}

static constexpr size_t kAudioI2SInternalAllocThreshold = 2 * 1024 * 1024;
static constexpr size_t kRuntimeInternalAllocThreshold = 4 * 1024;
static constexpr size_t kAudioI2SMinInternalFree = 48 * 1024;
static constexpr size_t kAudioI2SMinInternalLargestBlock = 24 * 1024;
static void audioRestoreRuntimeAllocThreshold() {
  if (!psramFound()) return;
  heap_caps_malloc_extmem_enable(kRuntimeInternalAllocThreshold);
  Serial.printf("[AUDIO] Restored extmem threshold to %u bytes after I2S init\n",
    (unsigned)kRuntimeInternalAllocThreshold);
}

static bool audioBeginI2SInternalAllocWindow() {
  if (!psramFound()) return true;

  const size_t internalFree =
    heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  const size_t internalLargest =
    heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);

  if (internalFree < kAudioI2SMinInternalFree ||
      internalLargest < kAudioI2SMinInternalLargestBlock) {
    Serial.printf("[AUDIO] Not enough internal heap for I2S/GDMA init: free=%lu largest=%lu\n",
      (unsigned long)internalFree, (unsigned long)internalLargest);
    return false;
  }

  // With PSRAM enabled, make the I2S/GDMA setup path use internal RAM for
  // essentially all default allocations so callback/user-context objects don't
  // land in external memory during driver init.
  heap_caps_malloc_extmem_enable(kAudioI2SInternalAllocThreshold);
  Serial.printf("[AUDIO] Forced default allocations <= %u bytes into internal RAM for I2S init\n",
    (unsigned)kAudioI2SInternalAllocThreshold);
  return true;
}

static bool audioInitI2S(uint32_t sampleRate) {
  audioShutdownI2S();

  i2s_config_t i2s_cfg = {};
  // DMA buffer sizing: must fit in free heap (~80-120KB available after WiFi+WebServer)
  // Each frame = 8 bytes (32-bit stereo). Total DMA = desc_num × frame_num × 8
  // Higher sample rates need more buffering to cover SD SPI latency spikes (50-100ms)
  Serial.printf("[AUDIO] Free heap before I2S: %lu bytes (largest block: %lu)\n",
    (unsigned long)esp_get_free_heap_size(), (unsigned long)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT));
  Serial.printf("[AUDIO] Internal heap before I2S: %lu bytes (largest internal block: %lu)\n",
    (unsigned long)heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
    (unsigned long)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
  if (!audioBeginI2SInternalAllocWindow()) return false;
  i2s_cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX);
  i2s_cfg.sample_rate = sampleRate;
  i2s_cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;
  i2s_cfg.bits_per_chan = I2S_BITS_PER_CHAN_32BIT;
  i2s_cfg.channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT;
  i2s_cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  i2s_cfg.intr_alloc_flags = 0;
  i2s_cfg.use_apll = true;
  i2s_cfg.tx_desc_auto_clear = true;
  i2s_cfg.fixed_mclk = 0;
  i2s_cfg.mclk_multiple = I2S_MCLK_MULTIPLE_256;
  if (sampleRate >= 88200) {
    i2s_cfg.dma_desc_num  = 12;    // 12 DMA descriptors
    i2s_cfg.dma_frame_num = 768;   // 768 frames each
    // = 12 × 768 × 8 = 73,728 bytes ≈ 96ms at 96kHz
  } else if (sampleRate >= 44100) {
    i2s_cfg.dma_desc_num  = 12;    // 12 descriptors for 44.1/48kHz
    i2s_cfg.dma_frame_num = 512;   // 512 frames each
    // = 12 × 512 × 8 = 49,152 bytes ≈ 139ms at 44.1kHz
  } else {
    i2s_cfg.dma_desc_num  = 8;
    i2s_cfg.dma_frame_num = 480;
  }
  if (i2s_driver_install(I2S_NUM_0, &i2s_cfg, 0, NULL) != ESP_OK) {
    Serial.println("[AUDIO] Failed to install legacy I2S driver");
    audioRestoreRuntimeAllocThreshold();
    return false;
  }

  i2s_pin_config_t pin_cfg = {
    .mck_io_num = I2S_PIN_NO_CHANGE,
    .bck_io_num = I2S_BCK_PIN,
    .ws_io_num = I2S_WS_PIN,
    .data_out_num = I2S_DOUT_PIN,
    .data_in_num = I2S_PIN_NO_CHANGE,
  };

  if (i2s_set_pin(I2S_NUM_0, &pin_cfg) != ESP_OK) {
    Serial.println("[AUDIO] Failed to set legacy I2S pins");
    audioShutdownI2S();
    audioRestoreRuntimeAllocThreshold();
    return false;
  }

  if (i2s_zero_dma_buffer(I2S_NUM_0) != ESP_OK) {
    Serial.println("[AUDIO] Failed to clear legacy I2S DMA buffer");
    audioShutdownI2S();
    audioRestoreRuntimeAllocThreshold();
    return false;
  }

  g_i2sInstalled = true;
  audioRestoreRuntimeAllocThreshold();

  Serial.printf("[AUDIO] Legacy I2S started: %lu Hz, 32-bit stereo, APLL=%s, DMA=%dx%d (%lu bytes)\n",
    (unsigned long)sampleRate,
    i2s_cfg.use_apll ? "on" : "off",
    (int)i2s_cfg.dma_desc_num,
    (int)i2s_cfg.dma_frame_num,
    (unsigned long)(i2s_cfg.dma_desc_num * i2s_cfg.dma_frame_num * 8));
  return true;
}

// ── Sample Conversion Helpers ───────────────────────────────
static inline int32_t audioRead24le_to_32(const uint8_t* q) {
  int32_t v = (int32_t)(q[0] | (q[1] << 8) | (q[2] << 16));
  if (v & 0x00800000) v |= 0xFF000000;
  return v << 8;
}

static inline int32_t audioRead32le(const uint8_t* q) {
  return (int32_t)(q[0] | (q[1] << 8) | (q[2] << 16) | (q[3] << 24));
}

static inline int32_t audioReadFloat32le(const uint8_t* q) {
  float f;
  memcpy(&f, q, 4);
  if (f > 1.0f) f = 1.0f;
  if (f < -1.0f) f = -1.0f;
  return (int32_t)(f * 2147483647.0f);
}

// Convert any supported WAV format to 32-bit stereo interleaved
static size_t audioConvertToStereo32(const uint8_t* inBuf, size_t n, const WavInfo& info, int32_t* outBuf) {
  size_t outSamples = 0;
  const size_t bytesPerChan = info.blockAlign / info.channels;
  const size_t frames = n / info.blockAlign;
  const uint8_t* p = inBuf;

  // Pre-compute volume scale ONCE per buffer (was per-sample — saves ~5K ops at 96kHz)
  const int32_t volScale = (int32_t)((constrain(g_volume, 0, 100) * 256L) / 100L);

  // Branch on format OUTSIDE the hot loop — eliminates per-sample conditional branching
  if (info.bitsPerSample == 16 && bytesPerChan == 2) {
    const bool stereo = (info.channels == 2);
    for (size_t i = 0; i < frames; i++) {
      int32_t l, r;
      int16_t s0 = (int16_t)(p[0] | (p[1] << 8));
      l = ((int32_t)s0) << 16;
      if (stereo) {
        int16_t s1 = (int16_t)(p[2] | (p[3] << 8));
        r = ((int32_t)s1) << 16;
      } else { r = l; }
      audioReactiveAccumulate(l, r);  // BEFORE volume — VU reacts to source level
      l = (int32_t)(((int64_t)l * volScale) >> 8);
      r = (int32_t)(((int64_t)r * volScale) >> 8);
      eqApply(l, r);
      outBuf[outSamples++] = l;
      outBuf[outSamples++] = r;
      p += info.blockAlign;
    }
  } else if (info.bitsPerSample == 24 && bytesPerChan == 3) {
    const bool stereo = (info.channels == 2);
    for (size_t i = 0; i < frames; i++) {
      int32_t l, r;
      l = audioRead24le_to_32(p);
      if (stereo) { r = audioRead24le_to_32(p + 3); } else { r = l; }
      audioReactiveAccumulate(l, r);  // BEFORE volume
      l = (int32_t)(((int64_t)l * volScale) >> 8);
      r = (int32_t)(((int64_t)r * volScale) >> 8);
      eqApply(l, r);
      outBuf[outSamples++] = l;
      outBuf[outSamples++] = r;
      p += info.blockAlign;
    }
  } else if (info.audioFormat == 3 && info.bitsPerSample == 32 && bytesPerChan == 4) {
    // IEEE 754 float WAV (audioFormat == 3)
    const bool stereo = (info.channels == 2);
    for (size_t i = 0; i < frames; i++) {
      int32_t l, r;
      l = audioReadFloat32le(p);
      if (stereo) { r = audioReadFloat32le(p + 4); } else { r = l; }
      audioReactiveAccumulate(l, r);
      l = (int32_t)(((int64_t)l * volScale) >> 8);
      r = (int32_t)(((int64_t)r * volScale) >> 8);
      eqApply(l, r);
      outBuf[outSamples++] = l;
      outBuf[outSamples++] = r;
      p += info.blockAlign;
    }
  } else if ((info.bitsPerSample == 24 || info.bitsPerSample == 32) && bytesPerChan == 4) {
    // PCM integer 24-in-32 or 32-bit
    const bool stereo = (info.channels == 2);
    for (size_t i = 0; i < frames; i++) {
      int32_t l, r;
      l = audioRead32le(p);
      if (stereo) { r = audioRead32le(p + 4); } else { r = l; }
      audioReactiveAccumulate(l, r);
      l = (int32_t)(((int64_t)l * volScale) >> 8);
      r = (int32_t)(((int64_t)r * volScale) >> 8);
      eqApply(l, r);
      outBuf[outSamples++] = l;
      outBuf[outSamples++] = r;
      p += info.blockAlign;
    }
  } else {
    return 0;
  }

  // Feed bass EQ state to reactive system once per buffer (was per-sample)
  if (g_eqEnabled) audioReactiveSetBass(g_eqStateL[0].y1);

  return outSamples * sizeof(int32_t);
}

// ── Scan /tracks for First Valid Playable Track ─────────────
String audioFindFirstPlayable() {
  File dir = SD.open("/tracks");
  if (!dir) {
    Serial.println("[AUDIO] Failed to open /tracks");
    return "";
  }
  if (!dir.isDirectory()) {
    dir.close();
    Serial.println("[AUDIO] /tracks is not a directory");
    return "";
  }

  while (true) {
    File file = dir.openNextFile();
    if (!file) break;

    String name = String(file.name());
    if (name.endsWith(".dpa") || name.endsWith(".DPA") ||
        name.endsWith(".wav") || name.endsWith(".WAV")) {
      String fullPath = name.startsWith("/") ? name : ("/tracks/" + name);
      Serial.printf("[AUDIO] Checking %s (%llu bytes)\n", fullPath.c_str(), (unsigned long long)file.size());
      WavInfo info = audioParsePlayable(file, fullPath);
      file.close();

      if (info.valid) {
        Serial.printf("[AUDIO] Valid %s: %s | %lu Hz | %u ch | %u-bit\n",
                      info.format.c_str(), fullPath.c_str(), (unsigned long)info.sampleRate,
                      info.channels, info.bitsPerSample);
        dir.close();
        return fullPath;
      } else {
        Serial.printf("[AUDIO] Skipping unsupported: %s\n", fullPath.c_str());
      }
    }
    else {
      file.close();
    }
  }

  dir.close();
  return "";
}

// ── List All Valid Playable Tracks in /tracks ───────────────
void audioInvalidateTracksJsonCache() {
  g_audioTracksJsonDirty = true;
  g_audioTracksJsonCache = "";
}

String audioListTracksJson() {
  if (g_wavCount == 0) return "[]";
  if (!g_audioTracksJsonDirty && g_audioTracksJsonCache.length() > 0) {
    return g_audioTracksJsonCache;
  }

  String json = "[";

  for (int i = 0; i < g_wavCount; i++) {
    File file = SD.open(g_wavPaths[i], FILE_READ);
    if (!file) continue;

    size_t fsize = file.size();
    WavInfo info = audioParsePlayable(file, g_wavPaths[i]);
    file.close();

    if (!info.valid) continue;  // safety net — shouldn't happen

    if (json.length() > 1) json += ",";
    json += "{\"idx\":" + String(i) + ",";
    json += "\"path\":\"" + g_wavPaths[i] + "\",";
    json += "\"format\":\"" + info.format + "\",";
    json += "\"title\":\"" + info.title + "\",";
    json += "\"size\":" + String((unsigned long)fsize) + ",";
    json += "\"sampleRate\":" + String(info.sampleRate) + ",";
    json += "\"channels\":" + String(info.channels) + ",";
    json += "\"bitsPerSample\":" + String(info.bitsPerSample) + ",";
    json += "\"codec\":\"wav\",";
    uint32_t bytesPerSample = (info.bitsPerSample / 8) * info.channels;
    uint32_t durationMs = 0;
    if (bytesPerSample > 0 && info.sampleRate > 0) {
      uint32_t totalSamples = info.dataSize / bytesPerSample;
      durationMs = (uint32_t)((uint64_t)totalSamples * 1000 / info.sampleRate);
    }
    json += "\"durationMs\":" + String(durationMs) + "}";
  }
  g_audioTracksJsonCache = json + "]";
  g_audioTracksJsonDirty = false;
  return g_audioTracksJsonCache;
}

static void audioRunPlaybackPath(const String& path) {
  Serial.printf("[AUDIO] Playback task start: %s\n", path.c_str());

  File f = SD.open(path, FILE_READ);
  if (!f) {
    Serial.printf("[AUDIO] Failed to open: %s\n", path.c_str());
    g_audioStopRequested = true;  // prevent auto-advance on error
    g_audioPlaying = false;
    g_audioNowPlaying = "";
    audioReactiveReset();
    return;
  }

  WavInfo info = audioParsePlayable(f, path);
  if (!info.valid) {
    Serial.printf("[AUDIO] Unsupported track: %s\n", path.c_str());
    f.close();
    g_audioStopRequested = true;  // prevent auto-advance on error
    g_audioPlaying = false;
    g_audioNowPlaying = "";
    audioReactiveReset();
    return;
  }

  if (!audioInitI2S(info.sampleRate)) {
    Serial.printf("[AUDIO] I2S init failed for %lu Hz — cannot play this track\n", (unsigned long)info.sampleRate);
    f.close();
    g_audioStopRequested = true;  // prevent auto-advance to next track
    g_audioPlaying = false;
    g_audioNowPlaying = "";
    audioReactiveReset();
    return;
  }

  // Store WAV info for position reporting
  g_wavChannels     = info.channels;
  g_wavSampleRate   = info.sampleRate;
  g_wavBitsPerSample = info.bitsPerSample;
  g_wavBlockAlign   = info.blockAlign;
  g_wavDataSize     = info.dataSize;
  g_wavDataOffset   = info.dataOffset;
  g_wavBytesRead    = 0;

  Serial.printf("[AUDIO] Playing %s: %s | %lu Hz | %u ch | %u-bit | %lu bytes\n",
                info.format.c_str(), path.c_str(), (unsigned long)info.sampleRate,
                info.channels, info.bitsPerSample, (unsigned long)info.dataSize);

  f.seek(info.dataOffset);
  g_audioCarryLen = 0;

  g_audioStopRequested = false;
  g_audioPlaying = true;
  g_audioNowPlaying = path;

  // Apply EQ preset at the file's native sample rate
  eqSetPreset(g_eq, info.sampleRate);

  unsigned long playbackHealthLogAt = millis();
  uint32_t loopCount = 0;

  while (!g_audioStopRequested && f.available()) {
    // Handle seek request from API/UI
    if (g_audioSeekRequested) {
      g_audioSeekRequested = false;
      uint32_t targetFrame = (uint32_t)((uint64_t)g_audioSeekToMs * info.sampleRate / 1000);
      uint32_t targetByte = targetFrame * info.blockAlign;
      if (targetByte > info.dataSize) targetByte = info.dataSize;
      // Align to block boundary
      targetByte = (targetByte / info.blockAlign) * info.blockAlign;
      f.seek(info.dataOffset + targetByte);
      g_wavBytesRead = targetByte;
      g_audioCarryLen = 0;  // discard any partial frame
      eqResetState();       // reset EQ filters to avoid pop
      Serial.printf("[AUDIO] Seek to %lu ms (byte %lu)\n", (unsigned long)g_audioSeekToMs, (unsigned long)targetByte);
      continue;
    }

    const size_t maxOutFrames = (sizeof(g_audioOutBuf) / sizeof(g_audioOutBuf[0])) / 2;
    size_t maxReadBytes = sizeof(g_audioInBuf) - g_audioCarryLen;
    size_t safeInBytes = maxOutFrames * info.blockAlign;
    if (safeInBytes > g_audioCarryLen) safeInBytes -= g_audioCarryLen;
    if (maxReadBytes > safeInBytes) maxReadBytes = safeInBytes;

    size_t n = f.read(g_audioInBuf + g_audioCarryLen, maxReadBytes);
    if (n == 0) break;

    n += g_audioCarryLen;

    size_t aligned = (n / info.blockAlign) * info.blockAlign;
    size_t leftover = n - aligned;

    if (leftover > 0) {
      memcpy(g_audioCarryBuf, g_audioInBuf + aligned, leftover);
    }

    size_t outBytes = audioConvertToStereo32(g_audioInBuf, aligned, info, g_audioOutBuf);
    if (outBytes == 0) {
      Serial.println("[AUDIO] Convert error during stream");
      break;
    }

    size_t written = 0;
    // Timeout in ticks — use portMAX_DELAY to block until DMA accepts all data
    // This prevents partial writes that cause clicks at buffer boundaries
    esp_err_t err = i2s_write(I2S_NUM_0, g_audioOutBuf, outBytes, &written, portMAX_DELAY);
    if (err != ESP_OK) {
      Serial.printf("[AUDIO] I2S write error: %d\n", (int)err);
      break;
    }

    // Compute audio features for this buffer (peak, RMS, envelope, beat)
    audioReactiveCompute();

    g_wavBytesRead += aligned;
    loopCount++;

    if (millis() - playbackHealthLogAt >= 5000) {
      uint32_t posMs = (g_wavSampleRate > 0 && g_wavBlockAlign > 0)
        ? (uint32_t)((uint64_t)(g_wavBytesRead / g_wavBlockAlign) * 1000 / g_wavSampleRate)
        : 0;
      Serial.printf("[AUDIO] Health: pos=%lums heap=%lu loops=%u\n",
        (unsigned long)posMs,
        (unsigned long)esp_get_free_heap_size(),
        (unsigned)loopCount);
      playbackHealthLogAt = millis();
      loopCount = 0;
    }

    if (leftover > 0) {
      memcpy(g_audioInBuf, g_audioCarryBuf, leftover);
    }
    g_audioCarryLen = leftover;
  }

  f.close();
  audioShutdownI2S();

  bool wasStop = g_audioStopRequested;
  g_audioPlaying = false;
  g_audioNowPlaying = "";
  audioReactiveReset();  // Clear audio features when not playing

  Serial.printf("[AUDIO] Playback %s\n", wasStop ? "stopped" : "complete");
}

// ── FreeRTOS Playback Worker (runs on core 1) ───────────────
static void audioPlaybackWorkerTask(void* param) {
  (void)param;
  char pathBuf[kAudioPendingPathMaxLen] = {};
  while (true) {
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    while (ulTaskNotifyTake(pdTRUE, 0) > 0) {
      // Collapse bursts of play requests so the worker uses the latest path.
    }
    audioLoadPendingPath(pathBuf, sizeof(pathBuf));
    if (pathBuf[0] == '\0') continue;
    audioRunPlaybackPath(String(pathBuf));
  }
}

static bool audioEnsurePlaybackWorker() {
  if (g_playbackTaskHandle) return true;
  BaseType_t result = xTaskCreatePinnedToCore(
    audioPlaybackWorkerTask,
    "audioPlay",
    kAudioPlaybackTaskStackBytes,
    nullptr,
    kAudioTaskPriority,
    &g_playbackTaskHandle,
    1
  );
  if (result != pdPASS) {
    g_playbackTaskHandle = nullptr;
    Serial.println("[AUDIO] Failed to create playback worker");
    return false;
  }
  return true;
}

// ── Public API ──────────────────────────────────────────────

// Lightweight hardware probe so boot can distinguish "configured" from "working".
static bool audioVerifyHardware(uint32_t sampleRate = 44100) {
  if (!audioInitI2S(sampleRate)) {
    Serial.println("[AUDIO] Hardware verification failed during I2S init");
    return false;
  }

  int32_t silence[16] = {};
  size_t bytesWritten = 0;
  esp_err_t err = i2s_write(
    I2S_NUM_0,
    silence,
    sizeof(silence),
    &bytesWritten,
    pdMS_TO_TICKS(50)
  );
  audioShutdownI2S();

  bool ok = (err == ESP_OK && bytesWritten > 0);
  Serial.printf(
    "[AUDIO] Hardware verification %s (bytes=%u)\n",
    ok ? "passed" : "failed",
    (unsigned)bytesWritten
  );
  return ok;
}

// Initialize audio subsystem and verify the I2S path can actually come up.
bool audioInit() {
  g_audioReady = audioVerifyHardware(44100);
  if (g_audioReady && !audioEnsurePlaybackWorker()) {
    g_audioReady = false;
  }
  Serial.printf("[AUDIO] Audio engine %s: BCK=GP%d, WSEL=GP%d, DIN=GP%d (ws_inv=true)\n",
    g_audioReady ? "ready" : "degraded",
    I2S_BCK_PIN, I2S_WS_PIN, I2S_DOUT_PIN);
  return g_audioReady;
}

// Start playback of a playable track file (WAV or DPA1, launches FreeRTOS task)
bool audioPlayFile(const char* path) {
  if (!g_audioReady) {
    Serial.println("[AUDIO] Not ready");
    return false;
  }
  if (!audioEnsurePlaybackWorker()) {
    return false;
  }

  // Stop current playback first
  if (g_audioPlaying) {
    audioStop();
    // Let the old playback task finish tearing down before we restart I2S.
    delay(kAudioRestartSettleMs);
  }

  g_audioStopRequested = false;
  g_audioPlaying = true;  // Set before waking the worker to close the race window.
  g_audioFile = String(path);
  audioStorePendingPath(path);
  xTaskNotifyGive(g_playbackTaskHandle);

  Serial.printf("[AUDIO] Started playback: %s\n", path);
  return true;
}

// Stop playback
void audioStop() {
  if (g_audioPlaying) {
    g_audioStopRequested = true;
    // Wait for task to finish (up to 200ms — tighter for snappy buttons)
    int timeout = 40;
    while (g_audioPlaying && timeout-- > 0) {
      delay(5);
    }
    if (g_audioPlaying) {
      Serial.println("[AUDIO] Warning: playback task did not stop in time");
    }
  }
  g_audioFile = "";
}

// ── Test Tone (440Hz, no SD needed) ─────────────────────────
static bool g_toneActive = false;
static uint32_t g_toneSamplesLeft = 0;

bool audioPlayTestTone() {
  if (!g_audioReady) {
    Serial.println("[AUDIO] Not ready");
    return false;
  }
  if (g_audioPlaying) audioStop();

  // Init I2S at 44100 for tone
  if (!audioInitI2S(44100)) return false;

  g_toneActive = true;
  g_toneSamplesLeft = 44100 * 3;  // 3 seconds
  g_audioPlaying = true;
  g_audioFile = "test_tone";
  g_wavSampleRate = 44100;
  g_wavChannels = 2;
  g_wavBitsPerSample = 32;
  g_wavDataSize = g_toneSamplesLeft * 8;
  g_wavBytesRead = 0;
  Serial.println("[AUDIO] Playing test tone (440Hz, 3s)");
  return true;
}

// Generate and send tone samples — called from audioTick when g_toneActive
static void audioToneTick() {
  if (!g_toneActive || g_toneSamplesLeft == 0) {
    if (g_toneActive) {
      g_toneActive = false;
      g_audioPlaying = false;
      g_audioFile = "";
      audioShutdownI2S();
      Serial.println("[AUDIO] Test tone complete");
    }
    return;
  }

  int32_t buf[512];  // 256 stereo frames (32-bit per channel to match I2S config)
  int samples = min((uint32_t)256, g_toneSamplesLeft);

  static uint32_t phase = 0;
  for (int i = 0; i < samples; i++) {
    float t = (float)phase / 44100.0f;
    int32_t val = (int32_t)(2000000000.0f * sinf(2.0f * PI * 440.0f * t));
    val = (int32_t)(((int64_t)val * constrain(g_volume, 0, 100)) / 100);
    buf[i * 2]     = val;
    buf[i * 2 + 1] = val;
    phase++;
  }

  size_t bytesWritten = 0;
  i2s_write(I2S_NUM_0, buf, samples * 8, &bytesWritten, pdMS_TO_TICKS(100));
  g_toneSamplesLeft -= samples;
  g_wavBytesRead += bytesWritten;
}

// ── Tick (call from loop — only needed for test tone) ───────
void audioTick() {
  if (g_toneActive) {
    audioToneTick();
  }
  // Normal WAV playback runs in its own FreeRTOS task, no tick needed
}

// ── Position / Duration Helpers ─────────────────────────────
void audioSeekToMs(uint32_t ms) {
  if (g_audioPlaying) {
    g_audioSeekToMs = ms;
    g_audioSeekRequested = true;
  }
}

uint32_t audioGetPositionMs() {
  if (!g_audioPlaying || g_wavSampleRate == 0 || g_wavBlockAlign == 0) return 0;
  uint32_t framesPlayed = g_wavBytesRead / g_wavBlockAlign;
  return (uint32_t)((uint64_t)framesPlayed * 1000 / g_wavSampleRate);
}

uint32_t audioGetDurationMs() {
  if (g_wavSampleRate == 0 || g_wavBlockAlign == 0) return 0;
  uint32_t totalFrames = g_wavDataSize / g_wavBlockAlign;
  return (uint32_t)((uint64_t)totalFrames * 1000 / g_wavSampleRate);
}

#endif // DPA_AUDIO_H
