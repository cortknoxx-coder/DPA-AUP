/*
 * DPA ESP-NOW Device Mesh — espnow_mesh.h
 * Broadcast mesh with master/follower model for multi-device sync
 *
 * Features:
 *   - Beacon broadcast every 5s (presence discovery)
 *   - Play sync: play/pause/next/prev commands (master → all)
 *   - LED theme broadcast on change (master → all)
 *   - Audio features at 20Hz for LED sync (master → all)
 *   - Peer tracking: up to 8 peers, 15s expiry
 *
 * Coexists with WiFi AP on channel 6 — no switching needed.
 * All messages ≤250 bytes (ESP-NOW limit).
 *
 * RAM cost: ~1.5KB (peer list + buffers)
 */

#ifndef DPA_ESPNOW_MESH_H
#define DPA_ESPNOW_MESH_H

#include <esp_now.h>
#include <WiFi.h>
#include <Preferences.h>

// ── Extern globals from .ino ──
extern String g_duid;
extern int g_trackIndex;
extern bool g_playing;
extern String g_ledIdle, g_ledPlay, g_ledIdlePat, g_ledPlayPat;
extern int g_brightness;
extern int g_battPercent;
extern int g_wavCount;
extern void playTrackByIndex(int idx);

// ── Extern from audio_reactive.h ──
struct AudioFeatures;
extern AudioFeatures g_audioFeatures;

// ── Message Types ─────────────────────────────────────────
#define MESH_MSG_BEACON      0x01  // 30 bytes — presence
#define MESH_MSG_PLAY_SYNC   0x02  // 16 bytes — play command
#define MESH_MSG_LED_THEME   0x03  // 15 bytes — LED colors
#define MESH_MSG_AUDIO_FEAT  0x04  // 16 bytes — audio features

// ── Magic Header ──────────────────────────────────────────
#define MESH_MAGIC_0  'D'
#define MESH_MAGIC_1  'P'

// ── Peer Tracking ─────────────────────────────────────────
#define MESH_MAX_PEERS    8
#define MESH_PEER_TIMEOUT 15000  // 15s expiry

struct MeshPeer {
  uint8_t  mac[6];
  char     duid[9];      // "DPA-XXXX" + null
  uint8_t  battPercent;
  bool     playing;
  bool     isMaster;
  uint32_t lastSeenMs;
  bool     active;
};

static MeshPeer g_meshPeers[MESH_MAX_PEERS] = {};

// ── Mesh State ────────────────────────────────────────────
static bool   g_meshEnabled  = false;
static String g_meshRole     = "auto";   // "auto", "master", "follower"
static String g_meshName     = "";       // Display name (defaults to DUID)
static bool   g_meshInited   = false;

// Broadcast address (all 0xFF = ESP-NOW broadcast)
static uint8_t g_broadcastAddr[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

// Timing
static uint32_t g_lastBeaconMs    = 0;
static uint32_t g_lastAudioFeatMs = 0;
static const uint32_t BEACON_INTERVAL_MS     = 5000;
static const uint32_t AUDIO_FEAT_INTERVAL_MS = 50;  // 20Hz

// ── Determine if we are master ────────────────────────────
bool meshIsMaster() {
  if (!g_meshEnabled) return false;
  if (g_meshRole == "master") return true;
  if (g_meshRole == "follower") return false;
  // Auto: master if playing
  return g_playing;
}

// ── Peer Management ───────────────────────────────────────
static int meshFindPeer(const uint8_t* mac) {
  for (int i = 0; i < MESH_MAX_PEERS; i++) {
    if (g_meshPeers[i].active && memcmp(g_meshPeers[i].mac, mac, 6) == 0) return i;
  }
  return -1;
}

static int meshAddPeer(const uint8_t* mac) {
  // Find existing
  int idx = meshFindPeer(mac);
  if (idx >= 0) return idx;
  // Find empty slot
  for (int i = 0; i < MESH_MAX_PEERS; i++) {
    if (!g_meshPeers[i].active) {
      memcpy(g_meshPeers[i].mac, mac, 6);
      g_meshPeers[i].active = true;
      g_meshPeers[i].lastSeenMs = millis();
      return i;
    }
  }
  // Evict oldest
  int oldest = 0;
  uint32_t oldestTime = g_meshPeers[0].lastSeenMs;
  for (int i = 1; i < MESH_MAX_PEERS; i++) {
    if (g_meshPeers[i].lastSeenMs < oldestTime) {
      oldest = i;
      oldestTime = g_meshPeers[i].lastSeenMs;
    }
  }
  memcpy(g_meshPeers[oldest].mac, mac, 6);
  g_meshPeers[oldest].active = true;
  g_meshPeers[oldest].lastSeenMs = millis();
  return oldest;
}

static void meshExpirePeers() {
  uint32_t now = millis();
  for (int i = 0; i < MESH_MAX_PEERS; i++) {
    if (g_meshPeers[i].active && (now - g_meshPeers[i].lastSeenMs > MESH_PEER_TIMEOUT)) {
      Serial.printf("[MESH] Peer expired: %s\n", g_meshPeers[i].duid);
      g_meshPeers[i].active = false;
    }
  }
}

int meshPeerCount() {
  int count = 0;
  for (int i = 0; i < MESH_MAX_PEERS; i++) {
    if (g_meshPeers[i].active) count++;
  }
  return count;
}

// ── Send Helpers ──────────────────────────────────────────

// Beacon: [DP][type][duid(8)][batt(1)][playing(1)][master(1)][trackIdx(2)][nameLen(1)][name(up to 14)]
void meshSendBeacon() {
  if (!g_meshEnabled || !g_meshInited) return;

  uint8_t buf[30] = {};
  buf[0] = MESH_MAGIC_0;
  buf[1] = MESH_MAGIC_1;
  buf[2] = MESH_MSG_BEACON;

  // DUID (8 chars, padded)
  String duid = g_duid;
  for (int i = 0; i < 8 && i < (int)duid.length(); i++) buf[3 + i] = duid[i];

  buf[11] = (uint8_t)constrain(g_battPercent, 0, 255);
  buf[12] = g_playing ? 1 : 0;
  buf[13] = meshIsMaster() ? 1 : 0;
  buf[14] = (uint8_t)(g_trackIndex & 0xFF);
  buf[15] = (uint8_t)((g_trackIndex >> 8) & 0xFF);

  // Device name (up to 14 chars)
  String name = g_meshName.length() > 0 ? g_meshName : g_duid;
  int nameLen = min((int)name.length(), 14);
  buf[16] = (uint8_t)nameLen;
  for (int i = 0; i < nameLen; i++) buf[17 + i] = name[i];

  esp_now_send(g_broadcastAddr, buf, 17 + nameLen);
}

// Play sync: [DP][type][cmd(1)][trackIdx(2)][duid(8)]
// cmd: 0x01=play, 0x02=pause, 0x03=next, 0x04=prev
void meshSendPlaySync(uint8_t cmd, int trackIdx) {
  if (!g_meshEnabled || !g_meshInited || !meshIsMaster()) return;

  uint8_t buf[16] = {};
  buf[0] = MESH_MAGIC_0;
  buf[1] = MESH_MAGIC_1;
  buf[2] = MESH_MSG_PLAY_SYNC;
  buf[3] = cmd;
  buf[4] = (uint8_t)(trackIdx & 0xFF);
  buf[5] = (uint8_t)((trackIdx >> 8) & 0xFF);
  for (int i = 0; i < 8 && i < (int)g_duid.length(); i++) buf[6 + i] = g_duid[i];

  esp_now_send(g_broadcastAddr, buf, 14);
  Serial.printf("[MESH] Play sync: cmd=0x%02X track=%d\n", cmd, trackIdx);
}

// Audio features: [DP][type][peakL(2)][peakR(2)][rms(2)][envelope(2)][bassEnergy(2)][beat(1)]
void meshSendAudioFeatures() {
  if (!g_meshEnabled || !g_meshInited || !meshIsMaster()) return;

  uint8_t buf[16] = {};
  buf[0] = MESH_MAGIC_0;
  buf[1] = MESH_MAGIC_1;
  buf[2] = MESH_MSG_AUDIO_FEAT;

  // Pack floats as uint16 (0-1000 range)
  auto pack = [](float v) -> uint16_t { return (uint16_t)(constrain(v, 0.0f, 1.0f) * 1000); };

  uint16_t pL = pack(g_audioFeatures.peakL);
  uint16_t pR = pack(g_audioFeatures.peakR);
  uint16_t rms = pack(g_audioFeatures.rms);
  uint16_t env = pack(g_audioFeatures.envelope);
  uint16_t bass = pack(g_audioFeatures.bassEnergy);

  buf[3] = pL & 0xFF; buf[4] = (pL >> 8) & 0xFF;
  buf[5] = pR & 0xFF; buf[6] = (pR >> 8) & 0xFF;
  buf[7] = rms & 0xFF; buf[8] = (rms >> 8) & 0xFF;
  buf[9] = env & 0xFF; buf[10] = (env >> 8) & 0xFF;
  buf[11] = bass & 0xFF; buf[12] = (bass >> 8) & 0xFF;
  buf[13] = g_audioFeatures.beatFlag ? 1 : 0;

  esp_now_send(g_broadcastAddr, buf, 14);
}

// LED theme: [DP][type][idleR][idleG][idleB][playR][playG][playB][bright(1)][idlePat(1)][playPat(1)]
void meshSendLedTheme() {
  if (!g_meshEnabled || !g_meshInited || !meshIsMaster()) return;

  // Parse hex color to RGB
  auto hexToR = [](const String& h) -> uint8_t {
    if (h.length() < 7) return 0;
    return (uint8_t)strtol(h.substring(1, 3).c_str(), NULL, 16);
  };
  auto hexToG = [](const String& h) -> uint8_t {
    if (h.length() < 7) return 0;
    return (uint8_t)strtol(h.substring(3, 5).c_str(), NULL, 16);
  };
  auto hexToB = [](const String& h) -> uint8_t {
    if (h.length() < 7) return 0;
    return (uint8_t)strtol(h.substring(5, 7).c_str(), NULL, 16);
  };

  // Pattern name → single byte ID for compact transmission
  auto patId = [](const String& p) -> uint8_t {
    if (p == "breathing") return 0;
    if (p == "solid") return 1;
    if (p == "comet") return 2;
    if (p == "rainbow") return 3;
    if (p == "fire") return 4;
    if (p == "sparkle") return 5;
    if (p == "wave") return 6;
    if (p == "audio_pulse") return 10;
    if (p == "audio_bass") return 11;
    if (p == "audio_beat") return 12;
    if (p == "audio_vu") return 13;
    if (p == "audio_comet") return 14;
    return 0;
  };

  uint8_t buf[15] = {};
  buf[0] = MESH_MAGIC_0;
  buf[1] = MESH_MAGIC_1;
  buf[2] = MESH_MSG_LED_THEME;
  buf[3] = hexToR(g_ledIdle); buf[4] = hexToG(g_ledIdle); buf[5] = hexToB(g_ledIdle);
  buf[6] = hexToR(g_ledPlay); buf[7] = hexToG(g_ledPlay); buf[8] = hexToB(g_ledPlay);
  buf[9] = (uint8_t)constrain(g_brightness, 0, 100);
  buf[10] = patId(g_ledIdlePat);
  buf[11] = patId(g_ledPlayPat);

  esp_now_send(g_broadcastAddr, buf, 12);
  Serial.println("[MESH] LED theme broadcast");
}

// ── Receive Callback ──────────────────────────────────────
#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
static void meshOnRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  const uint8_t* mac = info->src_addr;
#else
static void meshOnRecv(const uint8_t* mac, const uint8_t* data, int len) {
#endif
  if (len < 3) return;
  if (data[0] != MESH_MAGIC_0 || data[1] != MESH_MAGIC_1) return;

  uint8_t msgType = data[2];

  switch (msgType) {
    case MESH_MSG_BEACON: {
      if (len < 17) return;

      // Extract DUID first — skip own beacons before allocating a peer slot
      char duid[9] = {};
      memcpy(duid, data + 3, 8);
      if (String(duid) == g_duid) return;

      int idx = meshAddPeer(mac);
      if (idx < 0) return;

      strncpy(g_meshPeers[idx].duid, duid, 8);
      g_meshPeers[idx].battPercent = data[11];
      g_meshPeers[idx].playing = data[12] == 1;
      g_meshPeers[idx].isMaster = data[13] == 1;
      g_meshPeers[idx].lastSeenMs = millis();

      Serial.printf("[MESH] Beacon from %s (batt=%d%% playing=%d master=%d)\n",
        duid, data[11], data[12], data[13]);
      break;
    }

    case MESH_MSG_PLAY_SYNC: {
      if (len < 14 || meshIsMaster()) return;  // Followers only
      uint8_t cmd = data[3];
      int trackIdx = data[4] | (data[5] << 8);

      // Ignore our own messages
      char srcDuid[9] = {};
      memcpy(srcDuid, data + 6, 8);
      if (String(srcDuid) == g_duid) return;

      Serial.printf("[MESH] Play sync from %s: cmd=0x%02X track=%d\n", srcDuid, cmd, trackIdx);

      if (cmd == 0x01 && trackIdx >= 0 && trackIdx < g_wavCount) {
        playTrackByIndex(trackIdx);
      } else if (cmd == 0x02) {
        extern void audioStop();
        extern bool g_audioPlaying;
        if (g_audioPlaying) {
          g_playing = false;
          audioStop();
        }
      } else if (cmd == 0x03 || cmd == 0x04) {
        if (trackIdx >= 0 && trackIdx < g_wavCount) {
          playTrackByIndex(trackIdx);
        }
      }
      break;
    }

    case MESH_MSG_AUDIO_FEAT: {
      if (len < 14 || meshIsMaster()) return;  // Followers only
      // Unpack and apply to local audio features for LED sync
      auto unpack = [](uint8_t lo, uint8_t hi) -> float {
        return (float)((uint16_t)lo | ((uint16_t)hi << 8)) / 1000.0f;
      };
      // Write directly to volatile features — LED tick reads these
      // Cast away volatile for assignment (safe: single-core reader)
      AudioFeatures* af = (AudioFeatures*)&g_audioFeatures;
      af->peakL = unpack(data[3], data[4]);
      af->peakR = unpack(data[5], data[6]);
      af->rms = unpack(data[7], data[8]);
      af->envelope = unpack(data[9], data[10]);
      af->bassEnergy = unpack(data[11], data[12]);
      af->beatFlag = data[13] == 1;
      af->active = true;
      break;
    }

    case MESH_MSG_LED_THEME: {
      if (len < 12 || meshIsMaster()) return;  // Followers only
      // Unpack and apply LED theme
      auto patName = [](uint8_t id) -> String {
        switch (id) {
          case 0: return "breathing"; case 1: return "solid";
          case 2: return "comet"; case 3: return "rainbow";
          case 4: return "fire"; case 5: return "sparkle";
          case 6: return "wave"; case 10: return "audio_pulse";
          case 11: return "audio_bass"; case 12: return "audio_beat";
          case 13: return "audio_vu"; case 14: return "audio_comet";
          default: return "breathing";
        }
      };

      char hex[8];
      snprintf(hex, sizeof(hex), "#%02x%02x%02x", data[3], data[4], data[5]);
      g_ledIdle = String(hex);
      snprintf(hex, sizeof(hex), "#%02x%02x%02x", data[6], data[7], data[8]);
      g_ledPlay = String(hex);
      g_brightness = data[9];
      g_ledIdlePat = patName(data[10]);
      g_ledPlayPat = patName(data[11]);

      Serial.printf("[MESH] LED theme received: idle=%s play=%s bright=%d\n",
        g_ledIdle.c_str(), g_ledPlay.c_str(), g_brightness);
      break;
    }
  }
}

// ── NVS Persistence ───────────────────────────────────────
void meshLoadFromNVS() {
  Preferences prefs;
  prefs.begin("dpa_mesh", true);
  g_meshEnabled = prefs.getBool("enabled", false);
  g_meshRole = prefs.getString("role", "auto");
  g_meshName = prefs.getString("name", "");
  prefs.end();
}

void meshSaveToNVS() {
  Preferences prefs;
  prefs.begin("dpa_mesh", false);
  prefs.putBool("enabled", g_meshEnabled);
  prefs.putString("role", g_meshRole);
  prefs.putString("name", g_meshName);
  prefs.end();
}

// ── Init ──────────────────────────────────────────────────
bool espnowInit() {
  meshLoadFromNVS();

  if (!g_meshEnabled) {
    Serial.println("[MESH] Disabled (enable via dashboard or API)");
    return false;
  }

  if (esp_now_init() != ESP_OK) {
    Serial.println("[MESH] ESP-NOW init FAILED");
    return false;
  }

  // Register broadcast peer
  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, g_broadcastAddr, 6);
  peerInfo.channel = 0;  // Use current WiFi channel
  peerInfo.encrypt = false;
  if (!esp_now_is_peer_exist(g_broadcastAddr)) {
    esp_now_add_peer(&peerInfo);
  }

  // Register receive callback
  esp_now_register_recv_cb(meshOnRecv);

  g_meshInited = true;
  Serial.printf("[MESH] ESP-NOW active | role=%s | name=%s\n",
    g_meshRole.c_str(),
    (g_meshName.length() > 0 ? g_meshName : g_duid).c_str());
  return true;
}

// ── Runtime Enable/Disable ────────────────────────────────
bool espnowEnable() {
  if (g_meshInited) return true;
  g_meshEnabled = true;
  meshSaveToNVS();
  return espnowInit();
}

void espnowDisable() {
  if (g_meshInited) {
    esp_now_deinit();
    g_meshInited = false;
  }
  g_meshEnabled = false;
  // Clear peers
  for (int i = 0; i < MESH_MAX_PEERS; i++) g_meshPeers[i].active = false;
  meshSaveToNVS();
  Serial.println("[MESH] Disabled");
}

// ── Tick (call from main loop) ────────────────────────────
void espnowTick() {
  if (!g_meshEnabled || !g_meshInited) return;

  uint32_t now = millis();

  // Beacon every 5s
  if (now - g_lastBeaconMs >= BEACON_INTERVAL_MS) {
    meshSendBeacon();
    meshExpirePeers();
    g_lastBeaconMs = now;
  }

  // Audio features at 20Hz (master only, only while playing)
  if (meshIsMaster() && g_playing && (now - g_lastAudioFeatMs >= AUDIO_FEAT_INTERVAL_MS)) {
    meshSendAudioFeatures();
    g_lastAudioFeatMs = now;
  }
}

// ── JSON Builders for API ─────────────────────────────────
String meshStatusToJson() {
  String j = "{\"active\":" + String(g_meshInited ? "true" : "false");
  j += ",\"enabled\":" + String(g_meshEnabled ? "true" : "false");
  j += ",\"role\":\"" + g_meshRole + "\"";
  j += ",\"isMaster\":" + String(meshIsMaster() ? "true" : "false");
  j += ",\"name\":\"" + (g_meshName.length() > 0 ? g_meshName : g_duid) + "\"";
  j += ",\"peers\":" + String(meshPeerCount());
  j += ",\"peerList\":[";
  bool first = true;
  for (int i = 0; i < MESH_MAX_PEERS; i++) {
    if (!g_meshPeers[i].active) continue;
    if (!first) j += ",";
    first = false;
    j += "{\"duid\":\"" + String(g_meshPeers[i].duid) + "\"";
    j += ",\"battery\":" + String(g_meshPeers[i].battPercent);
    j += ",\"playing\":" + String(g_meshPeers[i].playing ? "true" : "false");
    j += ",\"master\":" + String(g_meshPeers[i].isMaster ? "true" : "false");
    // MAC as hex
    char macStr[18];
    snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
      g_meshPeers[i].mac[0], g_meshPeers[i].mac[1], g_meshPeers[i].mac[2],
      g_meshPeers[i].mac[3], g_meshPeers[i].mac[4], g_meshPeers[i].mac[5]);
    j += ",\"mac\":\"" + String(macStr) + "\"";
    j += "}";
  }
  j += "]}";
  return j;
}

#endif // DPA_ESPNOW_MESH_H
