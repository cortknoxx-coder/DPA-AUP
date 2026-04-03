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
  { "t1", "Neon Rain",     "808 Dreams", 234000, 1247, 8.2,  false,
    "Jaylen Carter, Mika Tanaka", "808 Dreams, Phantom",
    "USRC12600001", 128, "F minor", "Midnight Studio, Los Angeles" },
  { "t2", "Cyber Heart",   "808 Dreams", 198000, 8432, 6.9,  true,
    "Jaylen Carter, Devon Blake, Mika Tanaka", "808 Dreams",
    "USRC12600002", 135, "A minor", "Midnight Studio, Los Angeles" },
  { "t3", "Analog Dreams", "808 Dreams", 267000, 3891, 9.4,  false,
    "Jaylen Carter, Mika Tanaka, Reese Kim", "808 Dreams, Reese Kim",
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
  { "c1", "concert", "Midnight Tour - NYC",    "VIP meet & greet pass + backstage access for the Midnight Horizons world tour.", "2026-03-10", true },
  { "c2", "video",   "Behind the Synths",      "Exclusive studio session footage showing the making of Neon Rain.",              "2026-03-08", true },
  { "c3", "merch",   "Holographic Vinyl Drop",  "Limited edition holographic pressing, only 500 made worldwide.",                "2026-03-05", true },
  { "c4", "remix",   "Neon Rain (VIP Remix)",   "Unreleased VIP remix with extended outro. DPA exclusive.",                      "2026-03-01", false },
};
static const int NUM_CAPSULES = 4;

// ── JSON Helpers ─────────────────────────────────────────────
String escJson(const String& s) {
  String out = s;
  out.replace("\"", "\\\"");
  return out;
}

// ── Build Status JSON ────────────────────────────────────────
String buildStatusJson() {
  unsigned long uptime = (millis() - g_bootTime) / 1000;
  String j;
  j.reserve(900);
  j += "{\"name\":\"dpa-device\",\"ver\":\"" + g_fwVersion + "\",";
  j += "\"env\":\"dev\",\"duid\":\"" + g_duid + "\",";
  j += "\"ble\":false,\"wifi\":true,\"ip\":\"192.168.4.1\",";
  j += "\"sta\":{\"connected\":" + String(g_staConnected ? "true" : "false");
  j += ",\"ssid\":\"" + escJson(g_staSSID) + "\"";
  j += ",\"ip\":\"" + g_staIP + "\"";
  j += ",\"rssi\":" + String(g_staRSSI) + "},";
  j += "\"uptime_s\":" + String(uptime) + ",";
  // Battery
  j += "\"battery\":{\"voltage\":" + String(g_battVoltage, 2) + ",";
  j += "\"percent\":" + String(g_battPercent) + ",";
  j += "\"charging\":" + String(g_charging ? "true" : "false") + "},";
  // Audio
  j += "\"audio\":{\"volume\":" + String(g_volume) + ",";
  j += "\"eq\":\"" + g_eq + "\",\"mode\":\"" + g_playMode + "\",";
  j += "\"a2dp\":\"disconnected\",\"a2dpDevice\":\"\"},";
  // Storage (real SD if mounted, else mock)
  if (g_sdMounted) {
    j += "\"storage\":{\"totalMB\":" + String(g_sdTotalMB, 0) + ",";
    j += "\"usedMB\":" + String(g_sdUsedMB, 0) + ",";
    j += "\"freeMB\":" + String(g_sdFreeMB, 0) + ",";
  } else {
    j += "\"storage\":{\"totalMB\":0,\"usedMB\":0,\"freeMB\":0,";
  }
  j += "\"trackCount\":" + String(NUM_TRACKS) + ",";
  j += "\"capsuleCount\":" + String(NUM_CAPSULES) + ",\"videoCount\":1,";
  j += "\"sdMounted\":" + String(g_sdMounted ? "true" : "false") + "},";
  // ESP-NOW
  j += "\"espnow\":{\"active\":false,\"peers\":0,\"peerList\":[]},";
  // Player
  j += "\"player\":{\"trackIndex\":" + String(g_trackIndex) + ",";
  j += "\"trackId\":\"" + String(TRACKS[g_trackIndex].id) + "\",";
  j += "\"trackTitle\":\"" + String(TRACKS[g_trackIndex].title) + "\",";
  j += "\"playing\":" + String(g_playing ? "true" : "false") + ",";
  j += "\"posMs\":" + String(g_audioPlaying ? audioGetPositionMs() : 0) + ",";
  j += "\"durationMs\":" + String(g_audioPlaying ? audioGetDurationMs() : TRACKS[g_trackIndex].durationMs) + ",";
  j += "\"audioReady\":" + String(g_audioReady ? "true" : "false") + ",";
  j += "\"nowPlaying\":\"" + escJson(g_audioNowPlaying) + "\"},";
  // Counts
  j += "\"counts\":{\"play\":" + String(g_playCount) + ",";
  j += "\"pause\":" + String(g_pauseCount) + ",";
  j += "\"next\":" + String(g_nextCount) + ",";
  j += "\"prev\":" + String(g_prevCount) + "},";
  // LED
  j += "\"led\":{";
  j += "\"idle\":{\"color\":\"" + g_ledIdle + "\",\"pattern\":\"" + g_ledIdlePat + "\"},";
  j += "\"playback\":{\"color\":\"" + g_ledPlay + "\",\"pattern\":\"" + g_ledPlayPat + "\"},";
  j += "\"charging\":{\"color\":\"" + g_ledCharge + "\",\"pattern\":\"" + g_ledChargePat + "\"}},";
  // DCNP
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

// ── Command Dispatch ─────────────────────────────────────────
void handleCommand(uint8_t op) {
  switch (op) {
    case 0x01: // PLAY
      g_playing = true;
      g_playCount++;
      ledSetMode(LED_PLAYBACK);
      // If we have a WAV to play, start playback
      if (g_sdMounted && g_firstPlayableWav.length() > 0 && !g_audioPlaying) {
        audioPlayFile(g_firstPlayableWav.c_str());
      }
      Serial.println("[CMD] PLAY");
      break;
    case 0x02: // PAUSE
      g_playing = false;
      g_pauseCount++;
      if (g_audioPlaying) audioStop();
      ledSetMode(LED_IDLE);
      Serial.println("[CMD] PAUSE");
      break;
    case 0x03: // NEXT
      g_trackIndex = (g_trackIndex + 1) % NUM_TRACKS;
      g_nextCount++;
      Serial.printf("[CMD] NEXT -> track %d\n", g_trackIndex);
      break;
    case 0x04: // PREV
      g_trackIndex = (g_trackIndex - 1 + NUM_TRACKS) % NUM_TRACKS;
      g_prevCount++;
      Serial.printf("[CMD] PREV -> track %d\n", g_trackIndex);
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
    if (req->hasParam("i")) {
      int idx = req->getParam("i")->value().toInt();
      if (idx >= 0 && idx < NUM_TRACKS) {
        g_trackIndex = idx;
        g_playing = true;
        g_playCount++;
        ledSetMode(LED_PLAYBACK);
        Serial.printf("[API] Play track %d: %s\n", idx, TRACKS[idx].title);
      }
    }
    req->send(200, "application/json", "{\"ok\":true}");
  });

  // ── GET /api/volume?level=N ────────────────────────────────
  server.on("/api/volume", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (req->hasParam("level")) {
      g_volume = constrain(req->getParam("level")->value().toInt(), 0, 100);
      Serial.printf("[API] Volume -> %d\n", g_volume);
    }
    req->send(200, "application/json", "{\"ok\":true}");
  });

  // ── GET /api/eq?preset=X ───────────────────────────────────
  server.on("/api/eq", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (req->hasParam("preset")) {
      g_eq = req->getParam("preset")->value();
      Serial.printf("[API] EQ -> %s\n", g_eq.c_str());
    }
    req->send(200, "application/json", "{\"ok\":true}");
  });

  // ── GET /api/mode?mode=X ───────────────────────────────────
  server.on("/api/mode", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (req->hasParam("mode")) {
      g_playMode = req->getParam("mode")->value();
      Serial.printf("[API] Mode -> %s\n", g_playMode.c_str());
    }
    req->send(200, "application/json", "{\"ok\":true}");
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

    // Remount SD at fast speed for playback
    if (g_sdCurrentHz != SD_FAST_HZ) {
      sdMountFast();
    }

    bool ok = audioPlayFile(path.c_str());
    if (ok) {
      g_playing = true;
      g_playCount++;
      ledSetMode(LED_PLAYBACK);
    }
    String j = "{\"ok\":" + String(ok ? "true" : "false") + ",\"file\":\"" + escJson(path) + "\"}";
    req->send(200, "application/json", j);
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

  // ── GET /api/audio/stop ────────────────────────────────────
  server.on("/api/audio/stop", HTTP_GET, [](AsyncWebServerRequest* req) {
    audioStop();
    g_toneActive = false;
    g_playing = false;
    ledSetMode(LED_IDLE);
    req->send(200, "application/json", "{\"ok\":true}");
  });

  // ── GET /api/audio/wavs ────────────────────────────────────
  // Lists all valid WAV files in /tracks with metadata
  server.on("/api/audio/wavs", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!g_sdMounted) {
      req->send(503, "application/json", "{\"error\":\"sd not mounted\"}");
      return;
    }
    String j = "{\"wavs\":" + audioListWavsJson() + "}";
    req->send(200, "application/json", j);
  });

  // ── GET /api/sd/files?dir=/ ────────────────────────────────
  server.on("/api/sd/files", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!g_sdMounted) {
      req->send(503, "application/json", "{\"error\":\"sd not mounted\"}");
      return;
    }
    String dir = req->hasParam("dir") ? req->getParam("dir")->value() : "/";
    String j = "{\"dir\":\"" + dir + "\",\"files\":" + sdListFilesJson(dir.c_str()) + "}";
    req->send(200, "application/json", j);
  });

  // ── POST /api/sd/upload?path=/tracks/song.wav ──────────────
  // Multipart upload with .part temp file for reliability
  server.on("/api/sd/upload", HTTP_POST,
    // Request complete handler — rename .part file and send response
    [](AsyncWebServerRequest* req) {
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
      // Rescan for playable WAVs
      g_firstPlayableWav = audioFindFirstWav();
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

  // ── POST /api/sd/upload-raw?path=/file.wav ────────────────
  // Streams large files to SD — keeps file handle open across chunks
  // Uses .part temp file, renames on success
  static File g_uploadFile;
  static String g_uploadPath;
  server.on("/api/sd/upload-raw", HTTP_POST,
    // onRequest — called when upload is complete
    [](AsyncWebServerRequest* req) {
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
        // Rescan for playable WAVs
        g_firstPlayableWav = audioFindFirstWav();
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

  // ── DELETE /api/sd/delete?path=/file.wav ──────────────────
  server.on("/api/sd/delete", HTTP_DELETE, [](AsyncWebServerRequest* req) {
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
    // Rescan for playable WAVs if a track was deleted
    if (path.startsWith("/tracks/")) {
      g_firstPlayableWav = audioFindFirstWav();
    }
    req->send(200, "application/json", "{\"ok\":" + String(ok ? "true" : "false") + "}");
  });

  // ── GET /api/storage ───────────────────────────────────────
  server.on("/api/storage", HTTP_GET, [](AsyncWebServerRequest* req) {
    sdRefreshStats();
    String j = "{\"sdMounted\":" + String(g_sdMounted ? "true" : "false") + ",";
    j += "\"totalMB\":" + String(g_sdTotalMB, 0) + ",";
    j += "\"usedMB\":" + String(g_sdUsedMB, 0) + ",";
    j += "\"freeMB\":" + String(g_sdFreeMB, 0) + ",";
    j += "\"trackCount\":" + String(NUM_TRACKS) + ",";
    j += "\"capsuleCount\":" + String(NUM_CAPSULES) + ",\"videoCount\":1,";
    j += "\"sdSpeed\":" + String(g_sdCurrentHz) + ",";
    j += "\"files\":" + sdListFilesJson("/") + "}";
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
    for (int i = 0; i < NUM_CAPSULES; i++) {
      if (i > 0) j += ",";
      j += "{\"id\":\"" + String(CAPSULES[i].id) + "\",";
      j += "\"type\":\"" + String(CAPSULES[i].type) + "\",";
      j += "\"title\":\"" + String(CAPSULES[i].title) + "\",";
      j += "\"desc\":\"" + escJson(String(CAPSULES[i].desc)) + "\",";
      j += "\"date\":\"" + String(CAPSULES[i].date) + "\",";
      j += "\"delivered\":" + String(CAPSULES[i].delivered ? "true" : "false") + "}";
    }
    j += "]}";
    req->send(200, "application/json", j);
  });

  // ── GET /api/led/preview ─────────────────────────────────────
  server.on("/api/led/preview", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (req->hasParam("color")) {
      String color = req->getParam("color")->value();
      color.replace("%23", "#");
      if (req->hasParam("mode")) {
        String mode = req->getParam("mode")->value();
        if (mode == "idle")     g_ledIdle = color;
        else if (mode == "playback") g_ledPlay = color;
        else if (mode == "charging") g_ledCharge = color;
      } else {
        g_ledIdle = color;
      }
    }
    if (req->hasParam("pattern")) {
      String pattern = req->getParam("pattern")->value();
      if (req->hasParam("mode")) {
        String mode = req->getParam("mode")->value();
        if (mode == "idle")     g_ledIdlePat = pattern;
        else if (mode == "playback") g_ledPlayPat = pattern;
        else if (mode == "charging") g_ledChargePat = pattern;
      } else {
        g_ledIdlePat = pattern;
      }
    }
    if (req->hasParam("brightness")) {
      g_brightness = constrain(req->getParam("brightness")->value().toInt(), 0, 100);
    }
    Serial.printf("[LED PREVIEW] mode=%s color=%s pat=%s bright=%d\n",
      req->hasParam("mode") ? req->getParam("mode")->value().c_str() : "idle",
      req->hasParam("color") ? req->getParam("color")->value().c_str() : "-",
      req->hasParam("pattern") ? req->getParam("pattern")->value().c_str() : "-",
      g_brightness);
    req->send(200, "application/json", "{\"ok\":true}");
  });

  // ── GET /api/wifi/status ────────────────────────────────────
  server.on("/api/wifi/status", HTTP_GET, [](AsyncWebServerRequest* req) {
    String j = "{\"ap\":{\"ssid\":\"" + g_duid + "\",\"ip\":\"" + WiFi.softAPIP().toString() + "\",\"clients\":" + String(WiFi.softAPgetStationNum()) + "},";
    j += "\"sta\":{\"connected\":" + String(g_staConnected ? "true" : "false");
    j += ",\"ssid\":\"" + escJson(g_staSSID) + "\"";
    j += ",\"ip\":\"" + g_staIP + "\"";
    j += ",\"rssi\":" + String(g_staRSSI) + "}}";
    req->send(200, "application/json", j);
  });

  // ── GET /api/wifi/scan ────────────────────────────────────
  server.on("/api/wifi/scan", HTTP_GET, [](AsyncWebServerRequest* req) {
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

  // ── GET /api/wifi/connect?ssid=X&pass=Y ───────────────────
  server.on("/api/wifi/connect", HTTP_GET, [](AsyncWebServerRequest* req) {
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

  // ── GET /api/wifi/disconnect ──────────────────────────────
  server.on("/api/wifi/disconnect", HTTP_GET, [](AsyncWebServerRequest* req) {
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
