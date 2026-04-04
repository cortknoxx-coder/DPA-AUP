/*
 * DPA REST API — api.h
 * HTTP endpoint handlers for ESPAsyncWebServer
 * Matches Angular portal's DeviceWifiService expectations
 *
 * Upload endpoints use buffered writes with .part temp files
 * for reliable SD card writes on XTSD chips.
 */

#ifndef DPA_API_H
#define DPA_API_H

#include <ESPAsyncWebServer.h>
#include "dpa_wifi.h"
#include "led.h"
#include "sd_card.h"
#include "audio.h"
#include "audio_reactive.h"
#include "intelligence.h"

// ── Extern Globals (defined in .ino) ─────────────────────────
extern String g_duid, g_fwVersion;
extern int g_trackIndex, g_volume;
extern bool g_playing;
extern String g_eq, g_playMode;
extern float g_battVoltage;
extern int g_battPercent;
extern bool g_charging;
extern unsigned long g_bootTime;
extern int g_playCount, g_pauseCount, g_nextCount, g_prevCount;
extern String g_firstPlayableWav;
extern bool g_sdMounted;
extern String g_wavPaths[];
extern int g_wavCount;
extern String g_favorites[];
extern int g_favCount;
extern bool isFavorite(const String& path);
extern void toggleFavorite(const String& path);
extern void scanWavList();
extern void playTrackByIndex(int idx);
extern bool g_adminMode;

// ── Mock Track Data ──────────────────────────────────────────
struct TrackInfo {
  const char* id;
  const char* title;
  const char* artist;
  int durationMs;
  int plays;
  float sizeMB;
  bool isExplicit;
  const char* writers;
  const char* producers;
  const char* isrc;
  int bpm;
  const char* key;
  const char* recordedAt;
};

static const TrackInfo TRACKS[] = {
  { "t1", "Neon Rain",     "Cort Knoxx", 234000, 1247, 8.2,  false,
    "Jaylen Carter, Mika Tanaka", "Cort Knoxx, Phantom",
    "USRC12600001", 128, "F minor", "Midnight Studio, Los Angeles" },
  { "t2", "Cyber Heart",   "Cort Knoxx", 198000, 8432, 6.9,  true,
    "Jaylen Carter, Devon Blake, Mika Tanaka", "Cort Knoxx",
    "USRC12600002", 135, "A minor", "Midnight Studio, Los Angeles" },
  { "t3", "Analog Dreams", "Cort Knoxx", 267000, 3891, 9.4,  false,
    "Jaylen Carter, Mika Tanaka, Reese Kim", "Cort Knoxx, Reese Kim",
    "USRC12600003", 98, "D major", "Sunset Sound, Los Angeles" },
};
static const int NUM_TRACKS = 3;

// ── Mock Capsule Data ────────────────────────────────────────
struct CapsuleInfo {
  const char* id;
  const char* type;
  const char* title;
  const char* desc;
  const char* date;
  bool delivered;
};

static const CapsuleInfo CAPSULES[] = {
  { "c1", "concert", "Midnight Tour - NYC",    "VIP meet & greet pass + backstage access for the The Wack Game world tour.", "2026-03-10", true },
  { "c2", "video",   "Behind the Synths",      "Exclusive studio session footage showing the making of Neon Rain.",              "2026-03-08", true },
  { "c3", "merch",   "Holographic Vinyl Drop",  "Limited edition holographic pressing, only 500 made worldwide.",                "2026-03-05", true },
  { "c4", "remix",   "Neon Rain (VIP Remix)",   "Unreleased VIP remix with extended outro. DPA exclusive.",                      "2026-03-01", false },
};
static const int NUM_CAPSULES = 4;

// ── Runtime Capsule Store (creator-pushed over Wi-Fi) ───────
struct RuntimeCapsule {
  String id;
  String type;
  String title;
  String desc;
  String date;
  bool delivered;
};
static RuntimeCapsule g_runtimeCapsules[24];
static int g_runtimeCapsuleCount = 0;

// ── JSON Helpers ─────────────────────────────────────────────
String escJson(const String& s) {
  String out;
  out.reserve(s.length() + 8);
  for (unsigned int i = 0; i < s.length(); i++) {
    char c = s[i];
    switch (c) {
      case '"':  out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) { char buf[7]; snprintf(buf, sizeof(buf), "\\u%04x", c); out += buf; }
        else out += c;
    }
  }
  return out;
}


// ── Real Playable Track Helpers ──────────────────────────────

String audioGetCurrentOrFirstPlayablePath() {
  if (g_audioNowPlaying.length() > 0) return g_audioNowPlaying;
  if (g_firstPlayableWav.length() > 0) return g_firstPlayableWav;
  return audioFindFirstPlayable();
}

int audioGetWavCount() {
  if (!g_sdMounted) return 0;
  File dir = SD.open("/tracks");
  if (!dir || !dir.isDirectory()) {
    if (dir) dir.close();
    return 0;
  }
  int count = 0;
  while (true) {
    File file = dir.openNextFile();
    if (!file) break;
    String name = String(file.name());
    if (name.endsWith(".dpa") || name.endsWith(".DPA") || name.endsWith(".wav") || name.endsWith(".WAV")) {
      String full = name.startsWith("/") ? name : ("/tracks/" + name);
      WavInfo info = audioParsePlayable(file, full);
      if (info.valid) count++;
    }
    file.close();
  }
  dir.close();
  return count;
}

String audioGetWavPathByIndex(int wanted) {
  if (!g_sdMounted || wanted < 0) return "";
  File dir = SD.open("/tracks");
  if (!dir || !dir.isDirectory()) {
    if (dir) dir.close();
    return "";
  }
  int idx = 0;
  String result = "";
  while (true) {
    File file = dir.openNextFile();
    if (!file) break;
    String name = String(file.name());
    if (name.endsWith(".dpa") || name.endsWith(".DPA") || name.endsWith(".wav") || name.endsWith(".WAV")) {
      String full = name.startsWith("/") ? name : ("/tracks/" + name);
      WavInfo info = audioParsePlayable(file, full);
      if (info.valid) {
        if (idx == wanted) {
          result = full;
          file.close();
          break;
        }
        idx++;
      }
    }
    file.close();
  }
  dir.close();
  return result;
}

int audioGetCurrentPlayableIndex() {
  String current = audioGetCurrentOrFirstPlayablePath();
  if (!g_sdMounted || current.length() == 0) return -1;

  File dir = SD.open("/tracks");
  if (!dir || !dir.isDirectory()) {
    if (dir) dir.close();
    return -1;
  }
  int idx = 0;
  int found = -1;
  while (true) {
    File file = dir.openNextFile();
    if (!file) break;
    String name = String(file.name());
    if (name.endsWith(".dpa") || name.endsWith(".DPA") || name.endsWith(".wav") || name.endsWith(".WAV")) {
      String full = name.startsWith("/") ? name : ("/tracks/" + name);
      WavInfo info = audioParsePlayable(file, full);
      if (info.valid) {
        if (full == current) {
          found = idx;
          file.close();
          break;
        }
        idx++;
      }
    }
    file.close();
  }
  dir.close();
  return found;
}

String audioGetRelativePlayablePath(int delta) {
  int count = audioGetWavCount();
  if (count <= 0) return "";
  int idx = audioGetCurrentPlayableIndex();
  if (idx < 0) idx = 0;
  idx = (idx + delta + count) % count;
  return audioGetWavPathByIndex(idx);
}

// ── Build Status JSON ────────────────────────────────────────
String buildStatusJson() {
  unsigned long uptime = (millis() - g_bootTime) / 1000;
  // Use g_wavPaths[] from .ino instead of scanning SD every refresh
  String currentPath = (g_trackIndex >= 0 && g_trackIndex < g_wavCount) ? g_wavPaths[g_trackIndex] : g_audioNowPlaying;
  if (currentPath.length() == 0 && g_wavCount > 0) currentPath = g_wavPaths[0];

  String currentTitle = "";
  if (currentPath.length() > 0) {
    currentTitle = currentPath.substring(currentPath.lastIndexOf('/') + 1);
    currentTitle.replace(".dpa", "");
    currentTitle.replace(".DPA", "");
    currentTitle.replace(".wav", "");
    currentTitle.replace(".WAV", "");
    currentTitle.replace("_", " ");
  }

  // Build favorites array from in-memory list
  String favItems = "[";
  for (int i = 0; i < g_favCount; i++) {
    if (i > 0) favItems += ",";
    favItems += "\"" + escJson(g_favorites[i]) + "\"";
  }
  favItems += "]";

  String j;
  j.reserve(1800);
  j += "{\"name\":\"" + escJson(g_duid) + "\",\"ver\":\"" + g_fwVersion + "\",";
  j += "\"env\":\"dev\",\"duid\":\"" + g_duid + "\",";
  j += "\"admin\":" + String(g_adminMode ? "true" : "false") + ",";
  j += "\"ble\":false,\"wifi\":true,\"ip\":\"192.168.4.1\",";
  j += "\"sta\":{\"connected\":" + String(g_staConnected ? "true" : "false");
  j += ",\"ssid\":\"" + escJson(g_staSSID) + "\"";
  j += ",\"ip\":\"" + g_staIP + "\"";
  j += ",\"rssi\":" + String(g_staRSSI) + "},";
  j += "\"uptime_s\":" + String(uptime) + ",";
  j += "\"battery\":{\"voltage\":" + String(g_battVoltage, 2) + ",";
  j += "\"percent\":" + String(g_battPercent) + ",";
  j += "\"charging\":" + String(g_charging ? "true" : "false") + "},";
  j += "\"audio\":{\"volume\":" + String(g_volume) + ",";
  j += "\"eq\":\"" + g_eq + "\",\"mode\":\"" + g_playMode + "\",";
  j += "\"a2dp\":\"disconnected\",\"a2dpDevice\":\"\"},";
  if (g_sdMounted) {
    j += "\"storage\":{\"totalMB\":" + String(g_sdTotalMB, 0) + ",";
    j += "\"usedMB\":" + String(g_sdUsedMB, 0) + ",";
    j += "\"freeMB\":" + String(g_sdFreeMB, 0) + ",";
  } else {
    j += "\"storage\":{\"totalMB\":0,\"usedMB\":0,\"freeMB\":0,";
  }
  j += "\"trackCount\":" + String(g_wavCount) + ",";
  j += "\"capsuleCount\":" + String(NUM_CAPSULES) + ",\"videoCount\":1,";
  j += "\"sdMounted\":" + String(g_sdMounted ? "true" : "false") + "},";
  j += "\"player\":{\"trackIndex\":" + String(g_trackIndex) + ",";
  j += "\"trackId\":\"" + escJson(currentPath) + "\",";
  j += "\"trackTitle\":\"" + escJson(currentTitle) + "\",";
  j += "\"playing\":" + String(g_playing ? "true" : "false") + ",";
  j += "\"posMs\":" + String(g_audioPlaying ? audioGetPositionMs() : 0) + ",";
  j += "\"durationMs\":" + String(g_audioPlaying ? audioGetDurationMs() : 0) + ",";
  j += "\"audioReady\":" + String(g_audioReady ? "true" : "false") + ",";
  j += "\"nowPlaying\":\"" + escJson(g_audioNowPlaying) + "\",";
  j += "\"trackCount\":" + String(g_wavCount) + ",";
  j += "\"favorite\":" + String(isFavorite(currentPath) ? "true" : "false") + "},";
  j += "\"counts\":{\"play\":" + String(g_playCount) + ",";
  j += "\"pause\":" + String(g_pauseCount) + ",";
  j += "\"next\":" + String(g_nextCount) + ",";
  j += "\"prev\":" + String(g_prevCount) + "},";
  j += "\"led\":{";
  j += "\"idle\":{\"color\":\"" + g_ledIdle + "\",\"pattern\":\"" + g_ledIdlePat + "\"},";
  j += "\"playback\":{\"color\":\"" + g_ledPlay + "\",\"pattern\":\"" + g_ledPlayPat + "\"},";
  j += "\"charging\":{\"color\":\"" + g_ledCharge + "\",\"pattern\":\"" + g_ledChargePat + "\"},";
  j += "\"brightness\":" + String(g_brightness) + ",";
  j += "\"gradEnd\":\"" + g_ledGradEnd + "\"},";
  j += "\"favorites\":{\"count\":" + String(g_favCount) + ",\"items\":" + favItems + ",\"current\":" + String(isFavorite(currentPath) ? "true" : "false") + "},";
  j += "\"dcnp\":{";
  j += "\"concert\":\"" + g_dcnpConcert + "\",";
  j += "\"video\":\"" + g_dcnpVideo + "\",";
  j += "\"merch\":\"" + g_dcnpMerch + "\",";
  j += "\"signing\":\"" + g_dcnpSigning + "\",";
  j += "\"remix\":\"" + g_dcnpRemix + "\",";
  j += "\"other\":\"" + g_dcnpOther + "\"}";
  j += "}";
  return j;
}

// ── Simple JSON Value Extractor ──────────────────────────────
// Extracts string value for a given key from JSON body (no library needed)
String jsonVal(const String& body, const String& key) {
  String search = "\"" + key + "\"";
  int idx = body.indexOf(search);
  if (idx < 0) return "";
  int colon = body.indexOf(':', idx + search.length());
  if (colon < 0) return "";
  int qStart = body.indexOf('"', colon + 1);
  if (qStart < 0) return "";
  int qEnd = body.indexOf('"', qStart + 1);
  if (qEnd < 0) return "";
  return body.substring(qStart + 1, qEnd);
}

bool jsonBool(const String& body, const String& key, bool fallback = false) {
  String search = "\"" + key + "\"";
  int idx = body.indexOf(search);
  if (idx < 0) return fallback;
  int colon = body.indexOf(':', idx + search.length());
  if (colon < 0) return fallback;
  for (int i = colon + 1; i < (int)body.length(); i++) {
    char c = body.charAt(i);
    if (c == ' ' || c == '\n' || c == '\r' || c == '\t') continue;
    if (body.startsWith("true", i)) return true;
    if (body.startsWith("false", i)) return false;
    break;
  }
  return fallback;
}

void upsertRuntimeCapsule(const String& id, const String& type, const String& title, const String& desc, const String& date, bool delivered) {
  for (int i = 0; i < g_runtimeCapsuleCount; i++) {
    if (g_runtimeCapsules[i].id == id) {
      g_runtimeCapsules[i].type = type;
      g_runtimeCapsules[i].title = title;
      g_runtimeCapsules[i].desc = desc;
      g_runtimeCapsules[i].date = date;
      g_runtimeCapsules[i].delivered = delivered;
      return;
    }
  }
  if (g_runtimeCapsuleCount < 24) {
    g_runtimeCapsules[g_runtimeCapsuleCount++] = { id, type, title, desc, date, delivered };
    return;
  }
  for (int i = 0; i < 23; i++) {
    g_runtimeCapsules[i] = g_runtimeCapsules[i + 1];
  }
  g_runtimeCapsules[23] = { id, type, title, desc, date, delivered };
}

// ── Command Dispatch ─────────────────────────────────────────
void handleCommand(uint8_t op) {
  switch (op) {
    case 0x01: // PLAY/PAUSE toggle
      if (g_audioPlaying) {
        g_playing = false;   // Set BEFORE audioStop to prevent auto-advance race
        audioStop();
        g_pauseCount++;
        ledNotify("#ff6b35", "fade_out", 500);  // Warm orange fade = stop
        Serial.println("[CMD] PAUSE");
      } else if (g_wavCount > 0) {
        playTrackByIndex(g_trackIndex);
        ledNotify("#00ff88", "comet", 700);  // Green comet spin = play
        Serial.println("[CMD] PLAY");
      }
      break;
    case 0x02: // PAUSE
      g_playing = false;   // Set BEFORE audioStop
      g_pauseCount++;
      if (g_audioPlaying) audioStop();
      ledNotify("#ff6b35", "fade_out", 500);  // Warm orange fade = stop
      Serial.println("[CMD] PAUSE");
      break;
    case 0x03: // NEXT
      if (g_wavCount > 0) {
        int next = playlistNextTrack(g_trackIndex);
        g_nextCount++;
        ledNotify("#4f46e5", "chase_fwd", 400);  // Indigo chase forward = next
        playTrackByIndex(next);
        Serial.printf("[CMD] NEXT -> %d\n", next);
      }
      break;
    case 0x04: // PREV
      if (g_wavCount > 0) {
        int prev = playlistPrevTrack(g_trackIndex);
        g_prevCount++;
        ledNotify("#a855f7", "chase_rev", 400);  // Purple chase backward = prev
        playTrackByIndex(prev);
        Serial.printf("[CMD] PREV -> %d\n", prev);
      }
      break;
    case 0x60: // VOL UP
      g_volume = min(100, g_volume + 5);
      Serial.printf("[CMD] VOL UP -> %d\n", g_volume);
      break;
    case 0x61: // VOL DOWN
      g_volume = max(0, g_volume - 5);
      Serial.printf("[CMD] VOL DOWN -> %d\n", g_volume);
      break;
    default:
      Serial.printf("[CMD] Unknown op: 0x%02X\n", op);
      break;
  }
}

// ── Register All Routes ──────────────────────────────────────
void registerApiRoutes(AsyncWebServer& server) {

  // ── GET /api/status ────────────────────────────────────────
  server.on("/api/status", HTTP_GET, [](AsyncWebServerRequest* req) {
    req->send(200, "application/json", buildStatusJson());
  });

  // ── GET /api/admin/unlock?key=<DUID> ──────────────────────
  server.on("/api/admin/unlock", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (req->hasParam("key")) {
      String key = req->getParam("key")->value();
      if (key == g_duid) {
        g_adminMode = true;
        Serial.println("[ADMIN] Unlocked via API (DUID match)");
        req->send(200, "application/json", "{\"ok\":true,\"admin\":true}");
        return;
      }
    }
    req->send(403, "application/json", "{\"ok\":false,\"error\":\"invalid key\"}");
  });

  // ── GET /api/admin/lock ─────────────────────────────────
  server.on("/api/admin/lock", HTTP_GET, [](AsyncWebServerRequest* req) {
    g_adminMode = false;
    Serial.println("[ADMIN] Locked via API");
    req->send(200, "application/json", "{\"ok\":true,\"admin\":false}");
  });

  // ── GET /api/cmd?op=XX ─────────────────────────────────────
  server.on("/api/cmd", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (req->hasParam("op")) {
      String opStr = req->getParam("op")->value();
      uint8_t op = (uint8_t)strtol(opStr.c_str(), NULL, 16);
      handleCommand(op);
    }
    req->send(200, "application/json", "{\"ok\":true}");
  });

  // ── GET /api/track?i=N ─────────────────────────────────────
  server.on("/api/track", HTTP_GET, [](AsyncWebServerRequest* req) {
    bool ok = false;
    String path = "";
    if (req->hasParam("i")) {
      int idx = req->getParam("i")->value().toInt();
      path = audioGetWavPathByIndex(idx);
      if (path.length() > 0) {
        if (g_sdCurrentHz != SD_FAST_HZ) sdMountFast();
        ok = audioPlayFile(path.c_str());
        if (ok) {
          g_trackIndex = idx;
          g_playing = true;
          g_playCount++;
          ledSetMode(LED_PLAYBACK);
          ledNotify("#00ff88", "comet", 700);  // Green comet spin = play
          Serial.printf("[API] Play track %d: %s\n", idx, path.c_str());
        }
      }
    }
    req->send(200, "application/json", String("{\"ok\":") + (ok ? "true" : "false") + ",\"file\":\"" + escJson(path) + "\"}");
  });

  // ── GET /api/volume?level=N ────────────────────────────────
  server.on("/api/volume", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (req->hasParam("level")) {
      g_volume = constrain(req->getParam("level")->value().toInt(), 0, 100);
      Serial.printf("[API] Volume -> %d\n", g_volume);
      // Persist to NVS so volume survives reboot
      ledSaveToNVS();
    }
    req->send(200, "application/json", "{\"ok\":true,\"volume\":" + String(g_volume) + "}");
  });

  // ── GET /api/eq?preset=X ─────────────────────────────────────
  server.on("/api/eq", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (req->hasParam("preset")) {
      String preset = req->getParam("preset")->value();
      g_eq = preset;
      if (g_audioPlaying && g_wavSampleRate > 0) {
        eqSetPreset(preset, g_wavSampleRate);
      }
      Serial.printf("[API] EQ -> %s\n", preset.c_str());
      req->send(200, "application/json", "{\"ok\":true,\"eq\":\"" + escJson(preset) + "\"}");
    } else {
      String j = "{\"eq\":\"" + escJson(g_eq) + "\",\"presets\":[";
      j += "\"flat\",\"bass_boost\",\"vocal\",\"warm\"";
      j += "]}";
      req->send(200, "application/json", j);
    }
  });

  // ── GET /api/eq/custom?bass=X&mid=X&treble=X (dB, ±6 range) ──
  server.on("/api/eq/custom", HTTP_GET, [](AsyncWebServerRequest* req) {
    float bass = req->hasParam("bass") ? req->getParam("bass")->value().toFloat() : 0;
    float mid = req->hasParam("mid") ? req->getParam("mid")->value().toFloat() : 0;
    float treble = req->hasParam("treble") ? req->getParam("treble")->value().toFloat() : 0;
    g_eq = "custom";
    uint32_t sr = (g_audioPlaying && g_wavSampleRate > 0) ? g_wavSampleRate : 44100;
    eqSetCustom(bass, mid, treble, sr);
    Serial.printf("[API] EQ custom: bass=%.1f mid=%.1f treble=%.1f\n", bass, mid, treble);
    String j = "{\"ok\":true,\"eq\":\"custom\",\"bass\":" + String(bass,1) + ",\"mid\":" + String(mid,1) + ",\"treble\":" + String(treble,1) + "}";
    req->send(200, "application/json", j);
  });

  // ── GET /api/favorites/set?file=/tracks/x.wav&state=true|false ──
  // NOTE: Must be registered BEFORE /api/favorites to avoid prefix match
  // Idempotent — always sets to desired state, safe to retry
  server.on("/api/favorites/set", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!req->hasParam("file") || !req->hasParam("state")) {
      req->send(400, "application/json", "{\"error\":\"file and state params required\"}");
      return;
    }
    String path = req->getParam("file")->value();
    bool want = (req->getParam("state")->value() == "true");
    bool have = isFavorite(path);
    if (want && !have) {
      // Add
      if (g_favCount < 32) {
        int trackIdx = -1;
        for (int i = 0; i < g_wavCount; i++) { if (g_wavPaths[i] == path) { trackIdx = i; break; } }
        g_favorites[g_favCount++] = path;
        saveFavorites();
        analyticsSyncFavorite(trackIdx, true);
        Serial.println("[FAV] Set added: " + path);
      }
    } else if (!want && have) {
      // Remove
      int trackIdx = -1;
      for (int i = 0; i < g_wavCount; i++) { if (g_wavPaths[i] == path) { trackIdx = i; break; } }
      for (int i = 0; i < g_favCount; i++) {
        if (g_favorites[i] == path) {
          for (int j = i; j < g_favCount - 1; j++) g_favorites[j] = g_favorites[j + 1];
          g_favCount--;
          break;
        }
      }
      saveFavorites();
      analyticsSyncFavorite(trackIdx, false);
      Serial.println("[FAV] Set removed: " + path);
    }
    bool nowLiked = isFavorite(path);
    ledNotify(nowLiked ? "#cc0040" : "#444444", "heartbeat", 700);
    String j = "{\"ok\":true,\"file\":\"" + escJson(path) + "\",\"favorite\":" + String(nowLiked ? "true" : "false") + "}";
    req->send(200, "application/json", j);
  });

  // ── GET /api/favorites/toggle?file=/tracks/x.wav (legacy) ───
  // NOTE: Must be registered BEFORE /api/favorites to avoid prefix match
  server.on("/api/favorites/toggle", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!req->hasParam("file")) {
      req->send(400, "application/json", "{\"error\":\"file param required\"}");
      return;
    }
    String path = req->getParam("file")->value();
    bool wasLiked = isFavorite(path);
    toggleFavorite(path);
    bool nowLiked = !wasLiked;
    ledNotify(nowLiked ? "#cc0040" : "#444444", "heartbeat", 700);
    String j = "{\"ok\":true,\"file\":\"" + escJson(path) + "\",\"favorite\":" + String(nowLiked ? "true" : "false") + "}";
    req->send(200, "application/json", j);
  });

  // ── GET /api/favorites ──────────────────────────────────────
  server.on("/api/favorites", HTTP_GET, [](AsyncWebServerRequest* req) {
    String j = "{\"favorites\":[";
    for (int i = 0; i < g_favCount; i++) {
      if (i > 0) j += ",";
      j += "\"" + escJson(g_favorites[i]) + "\"";
    }
    j += "]}";
    req->send(200, "application/json", j);
  });

  // ── GET /api/mode?mode=X ───────────────────────────────────
  server.on("/api/mode", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (req->hasParam("mode")) {
      String mode = req->getParam("mode")->value();
      if (mode == "normal" || mode == "repeat_one") {
        g_playMode = mode;
        g_playlistMode = mode;
        Serial.printf("[API] Mode -> %s\n", mode.c_str());
      }
    }
    req->send(200, "application/json", "{\"ok\":true,\"mode\":\"" + g_playMode + "\"}");
  });

  // ── GET /api/audio/play?file=/path.wav ──────────────────────
  server.on("/api/audio/play", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!g_audioReady) {
      req->send(503, "application/json", "{\"error\":\"audio not ready\"}");
      return;
    }
    if (!g_sdMounted) {
      req->send(503, "application/json", "{\"error\":\"sd not mounted\"}");
      return;
    }
    if (!req->hasParam("file")) {
      req->send(400, "application/json", "{\"error\":\"file param required\"}");
      return;
    }
    String path = req->getParam("file")->value();
    Serial.printf("[API] /api/audio/play request: '%s'\n", path.c_str());

    // Remount SD at fast speed for playback
    if (g_sdCurrentHz != SD_FAST_HZ) {
      sdMountFast();
    }

    // Find the index so hardware buttons can track position
    bool foundIdx = false;
    for (int i = 0; i < g_wavCount; i++) {
      if (g_wavPaths[i] == path) { g_trackIndex = i; foundIdx = true; break; }
    }
    bool ok = audioPlayFile(path.c_str());
    if (ok) {
      g_playing = true;
      g_playCount++;
      ledSetMode(LED_PLAYBACK);
      ledNotify("#00ff88", "comet", 700);  // Green comet spin = play
    }
    String j = "{\"ok\":" + String(ok ? "true" : "false") + ",\"file\":\"" + escJson(path) + "\"}";
    req->send(200, "application/json", j);
  });

  // ── GET /api/audio/features ──────────────────────────────────
  // Real-time audio feature data for dashboard VU meter / reactive display
  server.on("/api/audio/features", HTTP_GET, [](AsyncWebServerRequest* req) {
    String j = "{\"active\":" + String(g_audioFeatures.active ? "true" : "false");
    j += ",\"peakL\":" + String(g_audioFeatures.peakL, 3);
    j += ",\"peakR\":" + String(g_audioFeatures.peakR, 3);
    j += ",\"rms\":" + String(g_audioFeatures.rms, 3);
    j += ",\"envelope\":" + String(g_audioFeatures.envelope, 3);
    j += ",\"bassEnergy\":" + String(g_audioFeatures.bassEnergy, 3);
    j += ",\"beat\":" + String(g_audioFeatures.beatFlag ? "true" : "false");
    j += "}";
    req->send(200, "application/json", j);
  });

  // ── GET /api/analytics ────────────────────────────────────────
  // Per-track play/skip counts and ratings
  server.on("/api/analytics", HTTP_GET, [](AsyncWebServerRequest* req) {
    req->send(200, "application/json", analyticsToJson());
  });

  // ── GET /api/audio/test ─────────────────────────────────────
  server.on("/api/audio/test", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!g_audioReady) {
      req->send(503, "application/json", "{\"error\":\"audio not ready\"}");
      return;
    }
    bool ok = audioPlayTestTone();
    if (ok) {
      g_playing = true;
      g_playCount++;
      ledSetMode(LED_PLAYBACK);
    }
    req->send(200, "application/json", "{\"ok\":" + String(ok ? "true" : "false") + "}");
  });

  // ── GET /api/audio/seek?ms=N ─────────────────────────────────
  server.on("/api/audio/seek", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!g_audioPlaying) {
      req->send(400, "application/json", "{\"error\":\"not playing\"}");
      return;
    }
    if (req->hasParam("ms")) {
      uint32_t ms = req->getParam("ms")->value().toInt();
      audioSeekToMs(ms);
      req->send(200, "application/json", "{\"ok\":true,\"seekMs\":" + String(ms) + "}");
    } else {
      req->send(400, "application/json", "{\"error\":\"ms param required\"}");
    }
  });

  // ── GET /api/audio/stop ────────────────────────────────────
  server.on("/api/audio/stop", HTTP_GET, [](AsyncWebServerRequest* req) {
    g_playing = false;   // Set BEFORE audioStop to prevent auto-advance race
    audioStop();
    g_toneActive = false;
    ledNotify("#ff6b35", "fade_out", 500);  // Warm orange fade = stop
    req->send(200, "application/json", "{\"ok\":true}");
  });

  // ── GET /api/audio/tracks ──────────────────────────────────
  // Lists all valid playable tracks (.dpa primary, .wav legacy fallback)
  server.on("/api/audio/tracks", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!g_sdMounted) {
      req->send(503, "application/json", "{\"error\":\"sd not mounted\"}");
      return;
    }
    String j = "{\"tracks\":" + audioListTracksJson() + "}";
    req->send(200, "application/json", j);
  });

  // ── GET /api/audio/wavs ────────────────────────────────────
  // Legacy alias for older clients — returns the same playable list payload.
  server.on("/api/audio/wavs", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!g_sdMounted) {
      req->send(503, "application/json", "{\"error\":\"sd not mounted\"}");
      return;
    }
    String j = "{\"wavs\":" + audioListTracksJson() + "}";
    req->send(200, "application/json", j);
  });

  // ── GET /api/sd/files?dir=/ ────────────────────────── [ADMIN]
  server.on("/api/sd/files", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!g_adminMode) {
      req->send(403, "application/json", "{\"error\":\"admin mode required\"}");
      return;
    }
    if (!g_sdMounted) {
      req->send(503, "application/json", "{\"error\":\"sd not mounted\"}");
      return;
    }
    String dir = req->hasParam("dir") ? req->getParam("dir")->value() : "/";
    String j = "{\"dir\":\"" + dir + "\",\"files\":" + sdListFilesJson(dir.c_str()) + "}";
    req->send(200, "application/json", j);
  });

  // ── POST /api/sd/upload?path=/tracks/song.wav ──── [ADMIN]
  // Multipart upload with .part temp file for reliability
  server.on("/api/sd/upload", HTTP_POST,
    // Request complete handler — rename .part file and send response
    [](AsyncWebServerRequest* req) {
      if (!g_adminMode) {
        req->send(403, "application/json", "{\"error\":\"admin mode required\"}");
        return;
      }
      if (!g_sdMounted) {
        req->send(503, "application/json", "{\"error\":\"sd not mounted\"}");
        return;
      }
      // Rename .part to final path
      String* storedPath = (String*)req->_tempObject;
      if (storedPath) {
        String partPath = *storedPath + ".part";
        if (SD.exists(partPath)) {
          // Remove old file if exists
          if (SD.exists(*storedPath)) {
            SD.remove(*storedPath);
          }
          SD.rename(partPath, *storedPath);
          Serial.printf("[SD] Upload finalized: %s\n", storedPath->c_str());
        }
        delete storedPath;
        req->_tempObject = nullptr;
      }
      sdRefreshStats();
      // Rescan playable track list (.dpa primary, .wav legacy fallback)
      scanWavList();
      String j = "{\"ok\":true,\"freeMB\":" + String(g_sdFreeMB, 0) + "}";
      req->send(200, "application/json", j);
    },
    // File upload handler (multipart)
    [](AsyncWebServerRequest* req, const String& filename, size_t index, uint8_t* data, size_t len, bool final) {
      if (!g_sdMounted) return;

      String path = req->hasParam("path") ? req->getParam("path")->value() : ("/tracks/" + filename);

      if (index == 0) {
        // Stop any playback before writing
        if (g_audioPlaying) {
          audioStop();
          delay(100);
        }

        // Writes are most reliable at the slow SD clock.
        sdMountSlow();

        // Create parent directories if needed
        String dir = path.substring(0, path.lastIndexOf('/'));
        if (dir.length() > 0 && !SD.exists(dir)) {
          SD.mkdir(dir);
        }

        // Store path for subsequent chunks
        req->_tempObject = (void*) new String(path);

        // Write to .part file
        String partPath = path + ".part";
        if (SD.exists(partPath)) SD.remove(partPath);
        Serial.printf("[SD] Upload start: %s (%s)\n", path.c_str(), filename.c_str());
        File f = SD.open(partPath, FILE_WRITE);
        if (f) {
          f.write(data, len);
          f.close();
        }
      } else {
        // Append subsequent chunks
        String* storedPath = (String*)req->_tempObject;
        if (storedPath) {
          String partPath = *storedPath + ".part";
          File f = SD.open(partPath, FILE_APPEND);
          if (f) {
            // Buffered write with retry
            size_t written = 0;
            int retries = 0;
            while (written < len && retries < 4) {
              size_t chunk = min(len - written, (size_t)8192);
              size_t w = f.write(data + written, chunk);
              if (w > 0) {
                written += w;
                retries = 0;
              } else {
                retries++;
                delay(10);
              }
            }
            f.close();

            // Progress every 100KB
            if ((index + len) % 102400 < len) {
              Serial.printf("[SD] Upload progress: %u bytes\n", (unsigned int)(index + len));
            }
          }
        }
      }

      if (final) {
        String* storedPath = (String*)req->_tempObject;
        if (storedPath) {
          Serial.printf("[SD] Upload received: %s (%u bytes total)\n", storedPath->c_str(), (unsigned int)(index + len));
        }
      }
    }
  );

  // ── POST /api/sd/upload-raw?path=/file.wav ────── [ADMIN]
  // Streams large files to SD — keeps file handle open across chunks
  // Uses .part temp file, renames on success
  static File g_uploadFile;
  static String g_uploadPath;
  server.on("/api/sd/upload-raw", HTTP_POST,
    // onRequest — called when upload is complete
    [](AsyncWebServerRequest* req) {
      if (!g_adminMode) {
        req->send(403, "application/json", "{\"error\":\"admin mode required\"}");
        return;
      }
      if (g_uploadFile) {
        g_uploadFile.close();
        // Rename .part to final
        String partPath = g_uploadPath + ".part";
        if (SD.exists(partPath)) {
          if (SD.exists(g_uploadPath)) SD.remove(g_uploadPath);
          SD.rename(partPath, g_uploadPath);
        }
        Serial.printf("[SD] Upload complete: %s\n", g_uploadPath.c_str());
        sdRefreshStats();
        // Rescan playable track list (.dpa primary, .wav legacy fallback)
        scanWavList();
      }
      String j = "{\"ok\":true,\"path\":\"" + escJson(g_uploadPath) + "\"}";
      req->send(200, "application/json", j);
    },
    NULL,
    // onBody — called for each chunk of data
    [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
      if (!g_sdMounted) return;

      if (index == 0) {
        // Stop playback before writing
        if (g_audioPlaying) {
          audioStop();
          delay(100);
        }

        // Writes are most reliable at the slow SD clock.
        sdMountSlow();

        // First chunk — open .part file
        g_uploadPath = req->hasParam("path") ? req->getParam("path")->value() : "/upload.bin";
        String dir = g_uploadPath.substring(0, g_uploadPath.lastIndexOf('/'));
        if (dir.length() > 0 && !SD.exists(dir)) SD.mkdir(dir);

        String partPath = g_uploadPath + ".part";
        if (SD.exists(partPath)) SD.remove(partPath);
        Serial.printf("[SD] Upload start: %s (%u bytes)\n", g_uploadPath.c_str(), (unsigned int)total);
        g_uploadFile = SD.open(partPath, FILE_WRITE);
      }

      if (g_uploadFile) {
        // Buffered write with retry
        size_t written = 0;
        int retries = 0;
        while (written < len && retries < 4) {
          size_t chunk = min(len - written, (size_t)8192);
          size_t w = g_uploadFile.write(data + written, chunk);
          if (w > 0) {
            written += w;
            retries = 0;
          } else {
            retries++;
            delay(10);
          }
        }
        // Progress every 500KB
        if ((index + len) % 524288 < len) {
          Serial.printf("[SD] Upload: %u / %u (%u%%)\n",
            (unsigned int)(index + len), (unsigned int)total,
            (unsigned int)((index + len) * 100 / total));
        }
      }
    }
  );

  // ── DELETE /api/sd/delete?path=/file.wav ──────── [ADMIN]
  server.on("/api/sd/delete", HTTP_DELETE, [](AsyncWebServerRequest* req) {
    if (!g_adminMode) {
      req->send(403, "application/json", "{\"error\":\"admin mode required\"}");
      return;
    }
    if (!g_sdMounted) {
      req->send(503, "application/json", "{\"error\":\"sd not mounted\"}");
      return;
    }
    if (!req->hasParam("path")) {
      req->send(400, "application/json", "{\"error\":\"path required\"}");
      return;
    }
    String path = req->getParam("path")->value();
    bool ok = SD.remove(path);
    Serial.printf("[SD] Delete %s: %s\n", path.c_str(), ok ? "ok" : "failed");
    sdRefreshStats();
    // Rescan playable track list if a track was deleted
    if (path.startsWith("/tracks/")) {
      scanWavList();
    }
    req->send(200, "application/json", "{\"ok\":" + String(ok ? "true" : "false") + "}");
  });

  // ── GET /api/storage ───────────────────────────────────────
  // Returns cached stats (always fast). Only refreshes if not playing.
  server.on("/api/storage", HTTP_GET, [](AsyncWebServerRequest* req) {
    sdRefreshStats();  // No-op during playback, uses cached values
    String j = "{\"sdMounted\":" + String(g_sdMounted ? "true" : "false") + ",";
    j += "\"totalMB\":" + String(g_sdTotalMB, 0) + ",";
    j += "\"usedMB\":" + String(g_sdUsedMB, 0) + ",";
    j += "\"freeMB\":" + String(g_sdFreeMB, 0) + ",";
    j += "\"trackCount\":" + String(g_wavCount) + ",";
    j += "\"capsuleCount\":" + String(NUM_CAPSULES) + ",\"videoCount\":1,";
    j += "\"sdSpeed\":" + String(g_sdCurrentHz) + ",";
    j += "\"files\":" + sdListFilesJson("/tracks") + "}";
    req->send(200, "application/json", j);
  });

  // ── GET /api/tracks ────────────────────────────────────────
  server.on("/api/tracks", HTTP_GET, [](AsyncWebServerRequest* req) {
    String j = "{\"tracks\":[";
    for (int i = 0; i < NUM_TRACKS; i++) {
      if (i > 0) j += ",";
      j += "{\"index\":" + String(i) + ",";
      j += "\"filename\":\"" + String(TRACKS[i].id) + ".dpa\",";
      j += "\"title\":\"" + String(TRACKS[i].title) + "\",";
      j += "\"artist\":\"" + String(TRACKS[i].artist) + "\",";
      j += "\"sizeMB\":" + String(TRACKS[i].sizeMB, 1) + ",";
      j += "\"plays\":" + String(TRACKS[i].plays) + ",";
      j += "\"durationMs\":" + String(TRACKS[i].durationMs) + ",";
      j += "\"explicit\":" + String(TRACKS[i].isExplicit ? "true" : "false") + ",";
      j += "\"writers\":\"" + String(TRACKS[i].writers) + "\",";
      j += "\"producers\":\"" + String(TRACKS[i].producers) + "\",";
      j += "\"isrc\":\"" + String(TRACKS[i].isrc) + "\",";
      j += "\"bpm\":" + String(TRACKS[i].bpm) + ",";
      j += "\"key\":\"" + String(TRACKS[i].key) + "\",";
      j += "\"recordedAt\":\"" + String(TRACKS[i].recordedAt) + "\"}";
    }
    j += "]}";
    req->send(200, "application/json", j);
  });

  // ── GET /api/capsules ──────────────────────────────────────
  server.on("/api/capsules", HTTP_GET, [](AsyncWebServerRequest* req) {
    String j = "{\"capsules\":[";
    bool first = true;
    for (int i = 0; i < g_runtimeCapsuleCount; i++) {
      if (!first) j += ",";
      j += "{\"id\":\"" + escJson(g_runtimeCapsules[i].id) + "\",";
      j += "\"type\":\"" + escJson(g_runtimeCapsules[i].type) + "\",";
      j += "\"title\":\"" + escJson(g_runtimeCapsules[i].title) + "\",";
      j += "\"desc\":\"" + escJson(g_runtimeCapsules[i].desc) + "\",";
      j += "\"date\":\"" + escJson(g_runtimeCapsules[i].date) + "\",";
      j += "\"delivered\":" + String(g_runtimeCapsules[i].delivered ? "true" : "false") + "}";
      first = false;
    }
    for (int i = 0; i < NUM_CAPSULES; i++) {
      if (!first) j += ",";
      j += "{\"id\":\"" + String(CAPSULES[i].id) + "\",";
      j += "\"type\":\"" + String(CAPSULES[i].type) + "\",";
      j += "\"title\":\"" + String(CAPSULES[i].title) + "\",";
      j += "\"desc\":\"" + escJson(String(CAPSULES[i].desc)) + "\",";
      j += "\"date\":\"" + String(CAPSULES[i].date) + "\",";
      j += "\"delivered\":" + String(CAPSULES[i].delivered ? "true" : "false") + "}";
      first = false;
    }
    j += "]}";
    req->send(200, "application/json", j);
  });

  // ── POST /api/capsule ──────────────────────────────────────
  server.on("/api/capsule", HTTP_POST,
    [](AsyncWebServerRequest* req) {},
    NULL,
    [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
      String body = "";
      body.reserve(len);
      for (size_t i = 0; i < len; i++) body += (char)data[i];

      String capsuleId = jsonVal(body, "capsuleId");
      if (capsuleId.length() == 0) capsuleId = jsonVal(body, "id");
      if (capsuleId.length() == 0) capsuleId = "cap-" + String(millis());

      String eventType = jsonVal(body, "eventType");
      if (eventType.length() == 0) eventType = jsonVal(body, "type");
      if (eventType.length() == 0) eventType = "other";

      String title = jsonVal(body, "title");
      if (title.length() == 0) title = "Capsule";

      String desc = jsonVal(body, "description");
      if (desc.length() == 0) desc = jsonVal(body, "desc");

      String date = jsonVal(body, "date");
      if (date.length() == 0) date = String((unsigned long)(millis() / 1000));

      bool delivered = jsonBool(body, "delivered", false);
      upsertRuntimeCapsule(capsuleId, eventType, title, desc, date, delivered);

      Serial.printf("[CAPSULE] Ingested id=%s type=%s title=%s\n",
        capsuleId.c_str(), eventType.c_str(), title.c_str());

      String j = "{\"ok\":true,\"id\":\"" + escJson(capsuleId) + "\"}";
      req->send(200, "application/json", j);
    }
  );

  // ── GET /api/led/preview ─────────────────────────────────────
  // Sets color/pattern and switches the active LED mode to match
  server.on("/api/led/preview", HTTP_GET, [](AsyncWebServerRequest* req) {
    LedMode targetMode = LED_IDLE;
    if (req->hasParam("mode")) {
      String mode = req->getParam("mode")->value();
      if (mode == "playback") targetMode = LED_PLAYBACK;
      else if (mode == "charging") targetMode = LED_CHARGING;
    }
    if (req->hasParam("color")) {
      String color = req->getParam("color")->value();
      color.replace("%23", "#");
      switch (targetMode) {
        case LED_PLAYBACK: g_ledPlay = color; break;
        case LED_CHARGING: g_ledCharge = color; break;
        default:           g_ledIdle = color; break;
      }
    }
    if (req->hasParam("pattern")) {
      String pattern = req->getParam("pattern")->value();
      switch (targetMode) {
        case LED_PLAYBACK: g_ledPlayPat = pattern; break;
        case LED_CHARGING: g_ledChargePat = pattern; break;
        default:           g_ledIdlePat = pattern; break;
      }
    }
    if (req->hasParam("brightness")) {
      g_brightness = constrain(req->getParam("brightness")->value().toInt(), 0, 100);
    }
    if (req->hasParam("gradEnd")) {
      String gc = req->getParam("gradEnd")->value();
      gc.replace("%23", "#");
      g_ledGradEnd = gc;
    }
    // Only switch LED mode when pattern is explicitly changed (avoids
    // "shock" flicker when color picker sends to both idle+playback modes)
    if (req->hasParam("pattern")) {
      ledSetMode(targetMode);
      ledSaveToNVS();  // Pattern changes are infrequent — safe to save immediately
    }
    // Save colors/brightness/grad to NVS (JS debounces these at 200ms)
    if (req->hasParam("color") || req->hasParam("gradEnd") || req->hasParam("brightness")) {
      ledSaveToNVS();
    }
    Serial.printf("[LED PREVIEW] mode=%d color=%s pat=%s bright=%d\n",
      targetMode,
      req->hasParam("color") ? req->getParam("color")->value().c_str() : "-",
      req->hasParam("pattern") ? req->getParam("pattern")->value().c_str() : "-",
      g_brightness);
    req->send(200, "application/json", "{\"ok\":true}");
  });

  // ── GET /api/wifi/status ────────────────────────────────────
  server.on("/api/wifi/status", HTTP_GET, [](AsyncWebServerRequest* req) {
    String j = "{\"ap\":{\"ssid\":\"" + String(DPA_AP_SSID) + "\",\"ip\":\"" + WiFi.softAPIP().toString() + "\",\"clients\":" + String(WiFi.softAPgetStationNum()) + "},";
    j += "\"sta\":{\"connected\":" + String(g_staConnected ? "true" : "false");
    j += ",\"ssid\":\"" + escJson(g_staSSID) + "\"";
    j += ",\"ip\":\"" + g_staIP + "\"";
    j += ",\"rssi\":" + String(g_staRSSI) + "}}";
    req->send(200, "application/json", j);
  });

  // ── GET /api/wifi/scan ──────────────────────────── [ADMIN]
  server.on("/api/wifi/scan", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!g_adminMode) {
      req->send(403, "application/json", "{\"error\":\"admin mode required\"}");
      return;
    }
    if (g_scanning || g_scanRequested) {
      req->send(200, "application/json", "{\"scanning\":true,\"networks\":[]}");
      return;
    }

    if (g_scanCount == 0 && !req->hasParam("results")) {
      wifiRequestScan();
      req->send(200, "application/json", "{\"scanning\":true,\"networks\":[]}");
      return;
    }

    String j = "{\"scanning\":false,\"networks\":[";
    for (int i = 0; i < g_scanCount; i++) {
      if (i > 0) j += ",";
      j += "{\"ssid\":\"" + escJson(g_scanResults[i].ssid) + "\",";
      j += "\"rssi\":" + String(g_scanResults[i].rssi) + ",";
      j += "\"open\":" + String(g_scanResults[i].open ? "true" : "false") + "}";
    }
    j += "]}";
    req->send(200, "application/json", j);
  });

  // ── GET /api/wifi/connect?ssid=X&pass=Y ─────────── [ADMIN]
  server.on("/api/wifi/connect", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!g_adminMode) {
      req->send(403, "application/json", "{\"error\":\"admin mode required\"}");
      return;
    }
    if (!req->hasParam("ssid")) {
      req->send(400, "application/json", "{\"error\":\"ssid required\"}");
      return;
    }

    if (g_staConnected) {
      wifiDisconnectSTA();
    }

    g_staSSID = req->getParam("ssid")->value();
    g_staPassword = req->hasParam("pass") ? req->getParam("pass")->value() : "";

    bool ok = wifiConnectSTA();

    if (ok) {
      wifiSaveToNVS();
    } else {
      g_staSSID = "";
      g_staPassword = "";
    }

    String j = "{\"ok\":" + String(ok ? "true" : "false");
    j += ",\"ip\":\"" + g_staIP + "\"";
    j += ",\"ssid\":\"" + escJson(req->getParam("ssid")->value()) + "\"}";
    req->send(200, "application/json", j);
  });

  // ── GET /api/wifi/disconnect ──────────────────── [ADMIN]
  server.on("/api/wifi/disconnect", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!g_adminMode) {
      req->send(403, "application/json", "{\"error\":\"admin mode required\"}");
      return;
    }
    wifiDisconnectSTA();
    wifiClearNVS();
    req->send(200, "application/json", "{\"ok\":true}");
  });

  // ── POST /api/theme ────────────────────────────────────────
  server.on("/api/theme", HTTP_POST,
    [](AsyncWebServerRequest* req) {},
    NULL,
    [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
      String body = "";
      for (size_t i = 0; i < len; i++) body += (char)data[i];

      Serial.println("[THEME] Received: " + body);

      String v;
      v = jsonVal(body, "idle_color");     if (v.length()) g_ledIdle = v;
      v = jsonVal(body, "idle_pattern");   if (v.length()) g_ledIdlePat = v;
      v = jsonVal(body, "play_color");     if (v.length()) g_ledPlay = v;
      v = jsonVal(body, "play_pattern");   if (v.length()) g_ledPlayPat = v;
      v = jsonVal(body, "charge_color");   if (v.length()) g_ledCharge = v;
      v = jsonVal(body, "charge_pattern"); if (v.length()) g_ledChargePat = v;
      v = jsonVal(body, "grad_end");       if (v.length()) g_ledGradEnd = v;
      if (!v.length()) {
        v = jsonVal(body, "gradEnd");
        if (v.length()) g_ledGradEnd = v;
      }

      int bIdx = body.indexOf("\"brightness\"");
      if (bIdx >= 0) {
        int col = body.indexOf(':', bIdx);
        if (col >= 0) {
          String bStr = "";
          for (int i = col + 1; i < (int)body.length(); i++) {
            char c = body.charAt(i);
            if (c >= '0' && c <= '9') bStr += c;
            else if (bStr.length() > 0) break;
          }
          if (bStr.length() > 0) {
            g_brightness = constrain(bStr.toInt(), 0, 100);
          }
        }
      }

      v = jsonVal(body, "dcnp_concert"); if (v.length()) g_dcnpConcert = v;
      v = jsonVal(body, "dcnp_video");   if (v.length()) g_dcnpVideo = v;
      v = jsonVal(body, "dcnp_merch");   if (v.length()) g_dcnpMerch = v;
      v = jsonVal(body, "dcnp_signing"); if (v.length()) g_dcnpSigning = v;
      v = jsonVal(body, "dcnp_remix");   if (v.length()) g_dcnpRemix = v;
      v = jsonVal(body, "dcnp_other");   if (v.length()) g_dcnpOther = v;

      ledSaveToNVS();
      Serial.println("[THEME] Applied & saved");

      req->send(200, "application/json", "{\"ok\":true}");
    }
  );
}

#endif // DPA_API_H
