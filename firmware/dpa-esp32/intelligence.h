/*
 * DPA On-Device Intelligence — intelligence.h
 * Sequential playlist + per-track analytics + DUID content binding
 *
 * Analytics: per-track play/skip counts, total listen time, last played,
 *            favorite timestamp, auto-derived rating (0-5)
 *            Persisted to /data/analytics.bin on track transitions.
 *
 * Playlist modes: normal (sequential), repeat_one
 *
 * Content Protection: SHA-256(DUID + filename) stored as /data/auth/<hash>.key
 *   Uses ESP32-S3 hardware SHA256 via mbedtls. Offline-only, no cloud.
 *
 * RAM cost: ~640 bytes (32 tracks × 20 bytes)
 */

#ifndef DPA_INTELLIGENCE_H
#define DPA_INTELLIGENCE_H

#include <SD.h>
#include <mbedtls/sha256.h>

// ── Extern globals from .ino ──
extern String g_duid;
extern String g_wavPaths[];
extern int g_wavCount;
extern String g_favorites[];
extern int g_favCount;
extern bool isFavorite(const String& path);

// ── Per-Track Analytics ──────────────────────────────────────
struct TrackStats {
  uint32_t playCount;     // complete plays (>50% listened)
  uint32_t skipCount;     // skips (<50% listened)
  uint32_t totalListenMs; // cumulative listen time
  uint32_t lastPlayedAt;  // millis() when last started
  uint16_t favoritedAt;   // millis()/60000 when hearted (0 = never)
  uint8_t  rating;        // 0-5, auto-derived from behavior
  uint8_t  _pad;          // alignment padding
};
// 20 bytes per track × 32 max = 640 bytes

static TrackStats g_trackStats[32] = {};
static const char* ANALYTICS_PATH = "/data/analytics.bin";
static bool g_analyticsDirty = false;  // deferred save flag

// ── Playlist State ──────────────────────────────────────────
static String g_playlistMode = "normal";  // normal, repeat_one

// Current playback tracking for skip detection
static int g_currentPlayIdx = -1;
static uint32_t g_currentPlayStartMs = 0;
static uint32_t g_currentTrackDurationMs = 0;

// ── Load Analytics from SD ──────────────────────────────────
void analyticsInit() {
  memset(g_trackStats, 0, sizeof(g_trackStats));

  if (!SD.exists(ANALYTICS_PATH)) {
    Serial.println("[INTEL] No analytics file — starting fresh");
    return;
  }

  File f = SD.open(ANALYTICS_PATH, FILE_READ);
  if (!f) return;

  int count = f.size() / sizeof(TrackStats);
  if (count > 32) count = 32;
  f.read((uint8_t*)g_trackStats, count * sizeof(TrackStats));
  f.close();
  Serial.printf("[INTEL] Loaded analytics for %d tracks\n", count);
}

// ── Save Analytics to SD ────────────────────────────────────
// Uses .part temp file strategy to prevent corruption on power loss
void analyticsSave() {
  if (!SD.exists("/data")) SD.mkdir("/data");
  const char* partPath = "/data/analytics.bin.part";
  if (SD.exists(partPath)) SD.remove(partPath);
  File f = SD.open(partPath, FILE_WRITE);
  if (!f) { Serial.println("[INTEL] Failed to save analytics"); return; }
  int count = g_wavCount > 32 ? 32 : g_wavCount;
  f.write((uint8_t*)g_trackStats, count * sizeof(TrackStats));
  f.close();
  // Atomic rename
  if (SD.exists(ANALYTICS_PATH)) SD.remove(ANALYTICS_PATH);
  SD.rename(partPath, ANALYTICS_PATH);
  g_analyticsDirty = false;
  Serial.printf("[INTEL] Saved analytics for %d tracks\n", count);
}

// Mark dirty — actual save deferred until playback stops
void analyticsDeferSave() {
  g_analyticsDirty = true;
}

// Call from loop when not playing to flush pending saves
void analyticsFlushIfDirty() {
  if (g_analyticsDirty) analyticsSave();
}

// ── Auto-derive rating from behavior ────────────────────────
static uint8_t computeRating(int idx) {
  if (idx < 0 || idx >= 32) return 0;
  const TrackStats& s = g_trackStats[idx];
  int score = 0;
  score += s.playCount * 2;
  score -= s.skipCount * 3;
  if (s.favoritedAt > 0) score += 5;
  if (score <= 0) return 0;
  if (score <= 3) return 1;
  if (score <= 8) return 2;
  if (score <= 15) return 3;
  if (score <= 25) return 4;
  return 5;
}

// ── Track Event Handlers ────────────────────────────────────

// Called to sync favorite status into analytics (call after toggleFavorite)
void analyticsSyncFavorite(int idx, bool isFav) {
  if (idx < 0 || idx >= 32) return;
  if (isFav && g_trackStats[idx].favoritedAt == 0) {
    g_trackStats[idx].favoritedAt = (uint16_t)(millis() / 60000);
    if (g_trackStats[idx].favoritedAt == 0) g_trackStats[idx].favoritedAt = 1; // avoid 0 = never
  } else if (!isFav) {
    g_trackStats[idx].favoritedAt = 0;
  }
  g_trackStats[idx].rating = computeRating(idx);
}

// Called when a track starts playing
void analyticsOnPlay(int idx, uint32_t durationMs) {
  // First: finalize previous track (skip detection)
  if (g_currentPlayIdx >= 0 && g_currentPlayIdx < 32 && g_currentPlayIdx != idx) {
    uint32_t listened = millis() - g_currentPlayStartMs;
    if (g_currentTrackDurationMs > 0 && listened < g_currentTrackDurationMs / 2) {
      // Skipped (listened < 50%)
      g_trackStats[g_currentPlayIdx].skipCount++;
    } else if (listened > 0) {
      // Completed (listened >= 50%)
      g_trackStats[g_currentPlayIdx].playCount++;
    }
    g_trackStats[g_currentPlayIdx].totalListenMs += listened;
    g_trackStats[g_currentPlayIdx].rating = computeRating(g_currentPlayIdx);
  }

  if (idx < 0 || idx >= 32) return;

  g_currentPlayIdx = idx;
  g_currentPlayStartMs = millis();
  g_currentTrackDurationMs = durationMs;
  g_trackStats[idx].lastPlayedAt = millis();

  // Defer save — will flush when playback stops (avoid SPI contention)
  analyticsDeferSave();
}

// Called when playback naturally completes (track reached end)
void analyticsOnComplete(int idx) {
  if (idx < 0 || idx >= 32) return;
  uint32_t listened = millis() - g_currentPlayStartMs;
  g_trackStats[idx].playCount++;
  g_trackStats[idx].totalListenMs += listened;
  g_trackStats[idx].rating = computeRating(idx);
  g_currentPlayIdx = -1;
  analyticsDeferSave();
}

// Called when user explicitly stops playback
void analyticsOnStop(int idx) {
  if (idx < 0 || idx >= 32) return;
  uint32_t listened = millis() - g_currentPlayStartMs;
  g_trackStats[idx].totalListenMs += listened;
  if (g_currentTrackDurationMs > 0 && listened < g_currentTrackDurationMs / 2) {
    g_trackStats[idx].skipCount++;
  } else {
    g_trackStats[idx].playCount++;
  }
  g_trackStats[idx].rating = computeRating(idx);
  g_currentPlayIdx = -1;
  analyticsDeferSave();
}

// ── Get Next/Prev Track Index ────────────────────────────────
int playlistNextTrack(int currentIdx) {
  if (g_wavCount == 0) return 0;
  if (g_playlistMode == "repeat_one") return currentIdx;
  // Simple sequential: next track by index, wrap around
  return (currentIdx + 1) % g_wavCount;
}

int playlistPrevTrack(int currentIdx) {
  if (g_wavCount == 0) return 0;
  if (g_playlistMode == "repeat_one") return currentIdx;
  // Simple sequential: previous track by index, wrap around
  return (currentIdx - 1 + g_wavCount) % g_wavCount;
}

// ── Content Protection (HMAC-SHA256 DUID binding) ────────────
// Generates a binding key for a file: SHA256(DUID + filename)
static String contentHash(const String& filename) {
  String input = g_duid + filename;
  uint8_t hash[32];
  mbedtls_sha256((const uint8_t*)input.c_str(), input.length(), hash, 0);
  // Convert first 8 bytes to hex string (16 chars — enough for lookup)
  char hex[17];
  for (int i = 0; i < 8; i++) sprintf(hex + i * 2, "%02x", hash[i]);
  hex[16] = 0;
  return String(hex);
}

// Create binding key file for a track
bool contentBind(const String& filename) {
  String hash = contentHash(filename);
  String keyPath = "/data/auth/" + hash + ".key";
  if (!SD.exists("/data/auth")) { SD.mkdir("/data"); SD.mkdir("/data/auth"); }
  if (SD.exists(keyPath)) return true;  // already bound
  File f = SD.open(keyPath, FILE_WRITE);
  if (!f) return false;
  f.println(filename);
  f.close();
  Serial.printf("[INTEL] Content bound: %s → %s\n", filename.c_str(), hash.c_str());
  return true;
}

// Verify a track is bound to this device
bool contentVerify(const String& filename) {
  String hash = contentHash(filename);
  String keyPath = "/data/auth/" + hash + ".key";
  return SD.exists(keyPath);
}

// ── JSON Builders for API ───────────────────────────────────
String analyticsToJson() {
  String j = "{\"tracks\":[";
  int count = g_wavCount > 32 ? 32 : g_wavCount;
  for (int i = 0; i < count; i++) {
    if (i > 0) j += ",";
    j += "{\"idx\":" + String(i);
    j += ",\"plays\":" + String(g_trackStats[i].playCount);
    j += ",\"skips\":" + String(g_trackStats[i].skipCount);
    j += ",\"listenMs\":" + String(g_trackStats[i].totalListenMs);
    j += ",\"rating\":" + String(g_trackStats[i].rating);
    j += "}";
  }
  j += "]}";
  return j;
}

#endif // DPA_INTELLIGENCE_H
