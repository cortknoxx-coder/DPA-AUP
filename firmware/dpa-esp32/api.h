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
#include <esp_heap_caps.h>
#include <esp_system.h>
#include <freertos/task.h>
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
extern bool g_battPresent;
extern unsigned long g_bootTime;
extern int g_playCount, g_pauseCount, g_nextCount, g_prevCount;
extern String g_firstPlayableWav;
extern bool g_sdMounted;
extern volatile bool g_uploadInProgress;
extern String g_bootState, g_sdState, g_uploadState, g_degradedReason;
extern String g_httpMode, g_wifiMaintenanceMode, g_lastUploadPath;
extern size_t g_lastUploadBytes;
extern size_t g_syncBytesWritten, g_syncBytesExpected, g_syncStageUsed;
extern String g_lastUploadMode;
extern uint32_t g_lastUploadDurationMs, g_lastUploadRateKBps, g_lastUploadSdHz;
extern bool g_httpReady, g_wifiReady, g_audioHardwareVerified;
extern String g_disconnectBreadcrumbKind, g_disconnectBreadcrumbScope;
extern String g_disconnectBreadcrumbCause, g_disconnectBreadcrumbDetail;
extern int g_disconnectBreadcrumbReasonCode;
extern unsigned long g_disconnectBreadcrumbAtMs, g_disconnectBreadcrumbUptimeS;
extern uint32_t g_disconnectBreadcrumbFreeHeap, g_disconnectBreadcrumbLargestHeapBlock;
extern int g_disconnectBreadcrumbStaRssi, g_disconnectBreadcrumbApClients;
extern unsigned long g_httpRestartCount;
extern unsigned long g_lastPortalHttpActivityAtMs;
extern bool g_portalHttpWatchdogArmed;
extern void notePortalHttpActivity();
extern String g_ingestBaseUrl, g_ingestDeviceToken, g_ingestState;
extern String g_ingestLastError, g_ingestLastFile, g_ingestLastSessionId, g_ingestLastAlbumId;
extern unsigned long g_ingestLastAt;
extern String g_capsuleOtaState, g_capsuleOtaLastError;
extern String g_capsuleOtaPendingDeliveryId, g_capsuleOtaPendingCapsuleId;
extern String g_capsuleOtaPendingTitle, g_capsuleOtaPendingInstallPath;
extern String g_capsuleOtaPendingDownloadUrl, g_capsuleOtaPendingLedIntent;
extern uint32_t g_capsuleOtaPendingCount, g_capsuleOtaUnseenCount;
extern unsigned long g_capsuleOtaLastPollAt, g_capsuleOtaLastChangeAt, g_capsuleOtaNextPollAt;
extern unsigned long g_capsuleOtaLastInstalledAtMs;
extern String g_wavPaths[];
extern int g_wavCount;
extern String g_favorites[];
extern int g_favCount;
extern bool isFavorite(const String& path);
extern void toggleFavorite(const String& path);
extern void scanWavList();
extern void playTrackByIndex(int idx);
extern bool g_adminMode;
extern void ingestSetConfig(const String& baseUrl, const String& deviceToken);
extern void ingestClearConfig();
extern bool ingestIsConfigured();
extern bool ingestPushFile(const String& sdPath, const String& albumId, const String& contentKind);

static constexpr uint32_t kControlPlanePressureTotalFreeMinBytes = 56 * 1024;
static constexpr uint32_t kControlPlanePressureLargestBlockMinBytes = 32 * 1024;
static constexpr uint32_t kControlPlanePressureInternalFreeMinBytes = 56 * 1024;
static constexpr uint32_t kControlPlanePressureInternalLargestBlockMinBytes = 28 * 1024;
static constexpr uint32_t kControlPlaneCriticalTotalFreeMinBytes = 48 * 1024;
static constexpr uint32_t kControlPlaneCriticalLargestBlockMinBytes = 28 * 1024;
static constexpr uint32_t kControlPlaneCriticalInternalFreeMinBytes = 48 * 1024;
static constexpr uint32_t kControlPlaneCriticalInternalLargestBlockMinBytes = 24 * 1024;
static constexpr uint32_t kControlPlaneRecoveryInternalFreeMinBytes = 48 * 1024;
static constexpr uint32_t kControlPlaneRecoveryInternalLargestBlockMinBytes = 24 * 1024;
static constexpr uint32_t kControlPlanePlaybackSafeInternalLargestBlockMinBytes = 28 * 1024;
static constexpr unsigned long kPortalHttpSilenceRestartMs = 12000UL;

static inline uint32_t controlPlaneFreeHeapBytes() {
  return ESP.getFreeHeap();
}

static inline uint32_t controlPlaneLargestHeapBlockBytes() {
  return heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
}

static inline uint32_t controlPlaneInternalFreeHeapBytes() {
  return heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
}

static inline uint32_t controlPlaneInternalLargestHeapBlockBytes() {
  return heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
}

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
  int version;
  bool seen;
  float price;      // 0 = free
  String ctaLabel;  // e.g. "Get Tickets", "Shop Now"
  String ctaUrl;    // link target
  bool hasImage;    // portal holds actual base64; device just knows it exists
  String localPath;   // installed capsule path for OTA-delivered content
  String deliveryId;  // backend delivery link when capsule came from OTA
  String source;      // "wifi" or "ota"
};
static RuntimeCapsule g_runtimeCapsules[24];
static int g_runtimeCapsuleCount = 0;
static const char* CAPSULES_PATH = "/data/capsules.json";
static const char* BOOKLET_PATH = "/data/booklet.json";
static const char* ALBUM_META_PATH = "/data/album_meta.json";

// Forward declarations for JSON helpers (defined later in this file)
String jsonVal(const String& body, const String& key);
bool jsonBool(const String& body, const String& key, bool fallback);
String jsonScalarVal(const String& body, const String& key);
String escJson(const String& s);

// Save capsules to SD as JSON array
void capsulesSave() {
  if (!SD.exists("/data")) SD.mkdir("/data");
  File f = SD.open(CAPSULES_PATH, FILE_WRITE);
  if (!f) { Serial.println("[CAPSULE] Save failed"); return; }
  f.print("[");
  for (int i = 0; i < g_runtimeCapsuleCount; i++) {
    if (i > 0) f.print(",");
    f.print("{\"id\":\""); f.print(escJson(g_runtimeCapsules[i].id));
    f.print("\",\"type\":\""); f.print(escJson(g_runtimeCapsules[i].type));
    f.print("\",\"title\":\""); f.print(escJson(g_runtimeCapsules[i].title));
    f.print("\",\"desc\":\""); f.print(escJson(g_runtimeCapsules[i].desc));
    f.print("\",\"date\":\""); f.print(escJson(g_runtimeCapsules[i].date));
    f.print("\",\"delivered\":"); f.print(g_runtimeCapsules[i].delivered ? "true" : "false");
    f.print(",\"version\":"); f.print(String(g_runtimeCapsules[i].version));
    f.print(",\"seen\":"); f.print(g_runtimeCapsules[i].seen ? "true" : "false");
    f.print(",\"price\":"); f.print(String(g_runtimeCapsules[i].price, 2));
    f.print(",\"ctaLabel\":\""); f.print(escJson(g_runtimeCapsules[i].ctaLabel));
    f.print("\",\"ctaUrl\":\""); f.print(escJson(g_runtimeCapsules[i].ctaUrl));
    f.print("\",\"hasImage\":"); f.print(g_runtimeCapsules[i].hasImage ? "true" : "false");
    f.print(",\"localPath\":\""); f.print(escJson(g_runtimeCapsules[i].localPath));
    f.print("\",\"deliveryId\":\""); f.print(escJson(g_runtimeCapsules[i].deliveryId));
    f.print("\",\"source\":\""); f.print(escJson(g_runtimeCapsules[i].source));
    f.print("}");
  }
  f.print("]");
  f.close();
  Serial.printf("[CAPSULE] Saved %d capsules to SD\n", g_runtimeCapsuleCount);
}

// Stream-parse capsules from SD JSON one object at a time to avoid
// loading the entire file into a single String (which spikes heap 5-15KB).
void capsulesLoad() {
  if (!SD.exists(CAPSULES_PATH)) return;
  File f = SD.open(CAPSULES_PATH, FILE_READ);
  if (!f) return;
  g_runtimeCapsuleCount = 0;

  static String obj;
  obj = "";
  obj.reserve(512);
  int depth = 0;
  bool inString = false;
  bool escaped = false;

  while (f.available() && g_runtimeCapsuleCount < 24) {
    char ch = (char)f.read();
    if (escaped) { escaped = false; if (depth > 0) obj += ch; continue; }
    if (ch == '\\' && inString) { escaped = true; if (depth > 0) obj += ch; continue; }
    if (ch == '"') inString = !inString;
    if (!inString) {
      if (ch == '{') {
        if (depth == 0) obj = "";
        depth++;
      }
      if (depth > 0) obj += ch;
      if (ch == '}') {
        depth--;
        if (depth == 0 && obj.length() > 2) {
          RuntimeCapsule c;
          c.id = jsonVal(obj, "id");
          c.type = jsonVal(obj, "type");
          c.title = jsonVal(obj, "title");
          c.desc = jsonVal(obj, "desc");
          c.date = jsonVal(obj, "date");
          c.delivered = jsonBool(obj, "delivered", false);
          String versionStr = jsonScalarVal(obj, "version");
          c.version = versionStr.length() > 0 ? (int)versionStr.toInt() : 1;
          if (c.version < 1) c.version = 1;
          c.seen = jsonBool(obj, "seen", false);
          String priceStr = jsonScalarVal(obj, "price");
          c.price = priceStr.length() > 0 ? priceStr.toFloat() : 0;
          c.ctaLabel = jsonVal(obj, "ctaLabel");
          c.ctaUrl = jsonVal(obj, "ctaUrl");
          c.hasImage = jsonBool(obj, "hasImage", false);
          c.localPath = jsonVal(obj, "localPath");
          c.deliveryId = jsonVal(obj, "deliveryId");
          c.source = jsonVal(obj, "source");
          if (c.source.length() == 0) c.source = "wifi";
          if (c.id.length() > 0) {
            g_runtimeCapsules[g_runtimeCapsuleCount++] = c;
          }
          obj = "";
        }
      }
    } else {
      if (depth > 0) obj += ch;
    }
  }
  f.close();
  obj = "";
  Serial.printf("[CAPSULE] Loaded %d capsules from SD\n", g_runtimeCapsuleCount);
}

bool upsertRuntimeCapsuleRecord(
  const String& capsuleId,
  const String& eventType,
  const String& title,
  const String& desc,
  const String& date,
  bool delivered,
  int version,
  bool seen,
  float price,
  const String& ctaLabel,
  const String& ctaUrl,
  bool hasImage,
  const String& localPath,
  const String& deliveryId,
  const String& source
) {
  RuntimeCapsule cap;
  cap.id = capsuleId;
  cap.type = eventType;
  cap.title = title;
  cap.desc = desc;
  cap.date = date;
  cap.delivered = delivered;
  cap.version = max(1, version);
  cap.seen = seen;
  cap.price = price;
  cap.ctaLabel = ctaLabel;
  cap.ctaUrl = ctaUrl;
  cap.hasImage = hasImage;
  cap.localPath = localPath;
  cap.deliveryId = deliveryId;
  cap.source = source.length() > 0 ? source : "wifi";

  bool found = false;
  for (int i = 0; i < g_runtimeCapsuleCount; i++) {
    if (g_runtimeCapsules[i].id == capsuleId) {
      g_runtimeCapsules[i] = cap;
      found = true;
      break;
    }
  }
  if (!found) {
    if (g_runtimeCapsuleCount < 24) {
      g_runtimeCapsules[g_runtimeCapsuleCount++] = cap;
    } else {
      for (int i = 0; i < 23; i++) g_runtimeCapsules[i] = g_runtimeCapsules[i + 1];
      g_runtimeCapsules[23] = cap;
    }
  }

  capsulesSave();
  return true;
}

bool markRuntimeCapsuleSeenAndSave(const String& capsuleId) {
  bool changed = false;
  for (int i = 0; i < g_runtimeCapsuleCount; i++) {
    if (g_runtimeCapsules[i].id == capsuleId) {
      if (!g_runtimeCapsules[i].seen) {
        g_runtimeCapsules[i].seen = true;
        changed = true;
      }
      break;
    }
  }
  if (changed) capsulesSave();
  return changed;
}

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


// ── Filename Sanitizer ───────────────────────────────────────
static String sanitizePath(const String& path) {
  String out = path;
  out.replace(" ", "_");
  out.replace("(", "");
  out.replace(")", "");
  out.replace("'", "");
  out.replace("&", "_");
  out.replace("#", "_");
  return out;
}

// Resolve ?path= for /api/art — only files under /art/, no traversal
static bool resolveArtRequestPath(const String& raw, String& outPath) {
  outPath = "";
  if (raw.length() == 0) return false;
  String p = raw;
  p.trim();
  if (p.indexOf("..") >= 0) return false;
  if (!p.startsWith("/")) p = "/art/" + p;
  if (!p.startsWith("/art/")) return false;
  String lower = p;
  lower.toLowerCase();
  if (!(lower.endsWith(".jpg") || lower.endsWith(".jpeg") ||
        lower.endsWith(".png")  || lower.endsWith(".webp"))) {
    return false;
  }
  outPath = sanitizePath(p);
  return true;
}

static const char* mimeForArtPath(const String& path) {
  String lower = path;
  lower.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

static void sendArtFromSd(AsyncWebServerRequest* req, const String& path) {
  if (!g_sdMounted) {
    req->send(503, "application/json", "{\"error\":\"sd not mounted\"}");
    return;
  }
  if (!SD.exists(path)) {
    req->send(404, "application/json", "{\"error\":\"not found\"}");
    return;
  }
  const char* ct = mimeForArtPath(path);
  AsyncWebServerResponse* response = req->beginResponse(SD, path, ct);
  response->addHeader("Cache-Control", "public, max-age=86400");
  response->addHeader("Access-Control-Allow-Origin", "*");
  req->send(response);
}

static void sendArtExistsJson(AsyncWebServerRequest* req, const String& path) {
  if (!g_sdMounted) {
    AsyncWebServerResponse* response = req->beginResponse(503, "application/json", "{\"error\":\"sd not mounted\"}");
    response->addHeader("Cache-Control", "no-store");
    response->addHeader("Access-Control-Allow-Origin", "*");
    req->send(response);
    return;
  }
  const bool exists = SD.exists(path);
  String body = "{\"ok\":true,\"path\":\"" + escJson(path) + "\",\"exists\":";
  body += exists ? "true" : "false";
  body += "}";
  AsyncWebServerResponse* response = req->beginResponse(200, "application/json", body);
  response->addHeader("Cache-Control", "no-store");
  response->addHeader("Access-Control-Allow-Origin", "*");
  req->send(response);
}

static void sendJsonFromSd(AsyncWebServerRequest* req, const char* path) {
  if (!g_sdMounted) {
    req->send(503, "application/json", "{\"error\":\"sd not mounted\"}");
    return;
  }
  if (!SD.exists(path)) {
    req->send(404, "application/json", "{\"error\":\"not found\"}");
    return;
  }
  AsyncWebServerResponse* response = req->beginResponse(SD, path, "application/json");
  response->addHeader("Cache-Control", "no-store");
  response->addHeader("Access-Control-Allow-Origin", "*");
  response->addHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response->addHeader("Access-Control-Allow-Headers", "Content-Type, Cache-Control, Pragma");
  req->send(response);
}

static bool apiHeavyRouteUnderPressure(
  uint32_t* freeHeapOut = nullptr,
  uint32_t* largestHeapBlockOut = nullptr,
  uint32_t* internalFreeHeapOut = nullptr,
  uint32_t* internalLargestHeapBlockOut = nullptr
) {
  const uint32_t freeHeap = controlPlaneFreeHeapBytes();
  const uint32_t largestHeapBlock = controlPlaneLargestHeapBlockBytes();
  const uint32_t internalFreeHeap = controlPlaneInternalFreeHeapBytes();
  const uint32_t internalLargestHeapBlock = controlPlaneInternalLargestHeapBlockBytes();
  if (freeHeapOut) *freeHeapOut = freeHeap;
  if (largestHeapBlockOut) *largestHeapBlockOut = largestHeapBlock;
  if (internalFreeHeapOut) *internalFreeHeapOut = internalFreeHeap;
  if (internalLargestHeapBlockOut) *internalLargestHeapBlockOut = internalLargestHeapBlock;
  return freeHeap < kControlPlanePressureTotalFreeMinBytes ||
         largestHeapBlock < kControlPlanePressureLargestBlockMinBytes ||
         internalFreeHeap < kControlPlanePressureInternalFreeMinBytes ||
         internalLargestHeapBlock < kControlPlanePressureInternalLargestBlockMinBytes;
}

static bool apiHeavyRouteCriticalPressure(
  uint32_t freeHeap,
  uint32_t largestHeapBlock,
  uint32_t internalFreeHeap,
  uint32_t internalLargestHeapBlock
) {
  return freeHeap < kControlPlaneCriticalTotalFreeMinBytes ||
         largestHeapBlock < kControlPlaneCriticalLargestBlockMinBytes ||
         internalFreeHeap < kControlPlaneCriticalInternalFreeMinBytes ||
         internalLargestHeapBlock < kControlPlaneCriticalInternalLargestBlockMinBytes;
}

static bool apiRejectHeavyRequest(AsyncWebServerRequest* req, const char* scope) {
  uint32_t freeHeap = 0;
  uint32_t largestHeapBlock = 0;
  uint32_t internalFreeHeap = 0;
  uint32_t internalLargestHeapBlock = 0;
  const bool underPressure = apiHeavyRouteUnderPressure(
    &freeHeap,
    &largestHeapBlock,
    &internalFreeHeap,
    &internalLargestHeapBlock
  );
  const bool criticalPressure = apiHeavyRouteCriticalPressure(
    freeHeap,
    largestHeapBlock,
    internalFreeHeap,
    internalLargestHeapBlock
  );
  if (!underPressure || (!criticalPressure && !g_audioPlaying && !g_uploadInProgress)) {
    return false;
  }

  String j = "{\"error\":\"busy\",\"scope\":\"" + String(scope) + "\",\"reason\":\"memory_guard\"";
  j += ",\"freeHeap\":" + String(freeHeap);
  j += ",\"largestHeapBlock\":" + String(largestHeapBlock);
  j += ",\"internalFreeHeap\":" + String(internalFreeHeap);
  j += ",\"internalLargestHeapBlock\":" + String(internalLargestHeapBlock);
  j += "}";
  AsyncWebServerResponse* response = req->beginResponse(503, "application/json", j);
  response->addHeader("Cache-Control", "no-store");
  response->addHeader("Retry-After", "2");
  req->send(response);
  return true;
}

static void persistLedStateSafely(const char* reason) {
  if (g_audioPlaying || g_uploadInProgress) {
    ledMarkDirty();
    Serial.printf("[LED] Deferred NVS save (%s) until idle\n", reason);
    return;
  }
  ledSaveToNVS();
}

static void attachChurnGuards(
  AsyncWebHandler& handler,
  size_t maxRequests,
  uint32_t windowSeconds,
  bool stripRequestHeaders = true
) {
  if (maxRequests > 0 && windowSeconds > 0) {
    AsyncRateLimitMiddleware* rateLimit = new AsyncRateLimitMiddleware();
    rateLimit->setMaxRequests(maxRequests);
    rateLimit->setWindowSize(windowSeconds);
    handler.addMiddleware(rateLimit);
  }

  if (stripRequestHeaders) {
    AsyncHeaderFreeMiddleware* headerFree = new AsyncHeaderFreeMiddleware();
    handler.addMiddleware(headerFree);
  }
}

static String capsuleNotificationColor(const String& eventType) {
  if (eventType == "concert") return g_dcnpConcert;
  if (eventType == "video") return g_dcnpVideo;
  if (eventType == "merch") return g_dcnpMerch;
  if (eventType == "signing") return g_dcnpSigning;
  if (eventType == "remix") return g_dcnpRemix;
  return g_dcnpOther;
}

static String capsuleNotificationPattern(const String& eventType) {
  if (eventType == "concert") return "flash_burst";
  if (eventType == "video") return "fade_glow";
  if (eventType == "merch") return "flash_hold";
  if (eventType == "signing") return "breathing";
  if (eventType == "remix") return "rhythmic_pulse";
  return "pulse";
}

static unsigned long capsuleNotificationDurationMs(const String& eventType) {
  if (eventType == "concert") return 1800UL;
  if (eventType == "video") return 7000UL;
  if (eventType == "merch") return 2600UL;
  if (eventType == "signing") return 8000UL;
  if (eventType == "remix") return 5000UL;
  return 1200UL;
}

static void triggerCapsuleLedNotification(const String& eventType) {
  const String color = capsuleNotificationColor(eventType);
  const String pattern = capsuleNotificationPattern(eventType);
  const unsigned long durationMs = capsuleNotificationDurationMs(eventType);
  Serial.printf("[CAPSULE] LED notify type=%s color=%s pattern=%s duration=%lu\n",
    eventType.c_str(),
    color.c_str(),
    pattern.c_str(),
    durationMs);
  ledNotify(color, pattern, durationMs);
}

static void sendDeferredFeatures(AsyncWebServerRequest* req) {
  AsyncWebServerResponse* response = req->beginResponse(
    200,
    "application/json",
    "{\"active\":false,\"peakL\":0,\"peakR\":0,\"rms\":0,\"envelope\":0,\"bassEnergy\":0,\"beat\":false,\"deferred\":true}"
  );
  response->addHeader("Cache-Control", "no-store");
  req->send(response);
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
static String g_statusJsonBuf;

String buildStatusJson() {
  unsigned long uptime = (millis() - g_bootTime) / 1000;
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

  String favItems = "[";
  for (int i = 0; i < g_favCount; i++) {
    if (i > 0) favItems += ",";
    favItems += "\"" + escJson(g_favorites[i]) + "\"";
  }
  favItems += "]";

  // Reuse static buffer to avoid heap alloc/dealloc churn on every poll.
  // reserve() is a no-op once the internal buffer is already >= 4500.
  String& j = g_statusJsonBuf;
  j = "";
  j.reserve(4500);
  j += "{\"name\":\"" + escJson(g_duid) + "\",\"ver\":\"" + g_fwVersion + "\",";
  j += "\"env\":\"dev\",\"duid\":\"" + g_duid + "\",";
  j += "\"admin\":" + String(g_adminMode ? "true" : "false") + ",";
  // Album metadata — drives the AP SSID and is the source of truth the
  // creator portal reads back after every push.
  j += "\"artist\":\"" + escJson(wifiGetArtist()) + "\",";
  j += "\"album\":\""  + escJson(wifiGetAlbum())  + "\",";
  j += "\"apSsid\":\"" + escJson(wifiGetApSSID()) + "\",";
  // Cover art file size — portal + dashboard use this to detect replacements
  // and force a cache-bust on the next tick. 0 = no cover on SD.
  {
    static unsigned long _coverBytesCached = 0;
    static unsigned long _coverBytesCheckedAt = 0;
    static String _coverRefreshKey = "";
    String nextCoverRefreshKey = g_lastUploadPath + "|" + String((unsigned long)g_lastUploadBytes);
    bool coverWasUpdated = (
      g_lastUploadPath == "/art/cover.jpg" ||
      g_lastUploadPath == "/art/cover.png"
    ) && nextCoverRefreshKey != _coverRefreshKey;
    unsigned long coverRefreshWindowMs = g_playing ? 15000UL : 5000UL;
    if (!g_sdMounted) {
      _coverBytesCached = 0;
      _coverBytesCheckedAt = millis();
      _coverRefreshKey = nextCoverRefreshKey;
    } else if (
      coverWasUpdated ||
      _coverBytesCheckedAt == 0 ||
      (millis() - _coverBytesCheckedAt) > coverRefreshWindowMs
    ) {
      unsigned long _coverBytes = 0;
      File _cf = SD.open("/art/cover.jpg");
      if (_cf) { _coverBytes = _cf.size(); _cf.close(); }
      else {
        File _cfp = SD.open("/art/cover.png");
        if (_cfp) { _coverBytes = _cfp.size(); _cfp.close(); }
      }
      _coverBytesCached = _coverBytes;
      _coverBytesCheckedAt = millis();
      _coverRefreshKey = nextCoverRefreshKey;
    }
    j += "\"coverBytes\":" + String(_coverBytesCached) + ",";
  }
  j += "\"ble\":false,\"wifi\":true,\"ip\":\"192.168.4.1\",";
    j += "\"sta\":{\"connected\":" + String(g_staConnected ? "true" : "false");
    j += ",\"ssid\":\"" + escJson(g_staSSID) + "\"";
    j += ",\"ip\":\"" + g_staIP + "\"";
    j += ",\"rssi\":" + String(g_staRSSI);
    j += ",\"joinPending\":" + String(g_staJoinPending ? "true" : "false") + "},";
  j += "\"bootState\":\"" + escJson(g_bootState) + "\",";
  j += "\"sdState\":\"" + escJson(g_sdState) + "\",";
  j += "\"uploadState\":\"" + escJson(g_uploadState) + "\",";
  j += "\"degradedReason\":\"" + escJson(g_degradedReason) + "\",";
  j += "\"httpReady\":" + String(g_httpReady ? "true" : "false") + ",";
  j += "\"httpMode\":\"" + escJson(g_httpMode) + "\",";
  {
    const unsigned long portalHttpAgeMs = g_lastPortalHttpActivityAtMs > 0 ? (millis() - g_lastPortalHttpActivityAtMs) : 0;
    j += "\"portalHttp\":{";
    j += "\"watchdogArmed\":" + String(g_portalHttpWatchdogArmed ? "true" : "false") + ",";
    j += "\"lastActivityAtMs\":" + String(g_lastPortalHttpActivityAtMs) + ",";
    j += "\"lastActivityAgeMs\":" + String(portalHttpAgeMs);
    j += "},";
  }
  j += "\"audioVerified\":" + String(g_audioHardwareVerified ? "true" : "false") + ",";
  j += "\"wifiMaintenance\":\"" + escJson(g_wifiMaintenanceMode) + "\",";
  j += "\"lastUploadPath\":\"" + escJson(g_lastUploadPath) + "\",";
  j += "\"lastUploadBytes\":" + String((unsigned long)g_lastUploadBytes) + ",";
  j += "\"lastUploadMode\":\"" + escJson(g_lastUploadMode) + "\",";
  j += "\"uploadBytesWritten\":" + String((unsigned long)(g_syncBytesWritten + g_syncStageUsed)) + ",";
  j += "\"uploadBytesExpected\":" + String((unsigned long)g_syncBytesExpected) + ",";
  j += "\"lastUploadDurationMs\":" + String((unsigned long)g_lastUploadDurationMs) + ",";
  j += "\"lastUploadRateKBps\":" + String((unsigned long)g_lastUploadRateKBps) + ",";
  j += "\"lastUploadSdHz\":" + String((unsigned long)g_lastUploadSdHz) + ",";
  {
    const unsigned long breadcrumbAgeMs = g_disconnectBreadcrumbAtMs > 0 ? (millis() - g_disconnectBreadcrumbAtMs) : 0;
    j += "\"disconnectBreadcrumb\":{";
    j += "\"kind\":\"" + escJson(g_disconnectBreadcrumbKind) + "\",";
    j += "\"scope\":\"" + escJson(g_disconnectBreadcrumbScope) + "\",";
    j += "\"cause\":\"" + escJson(g_disconnectBreadcrumbCause) + "\",";
    j += "\"detail\":\"" + escJson(g_disconnectBreadcrumbDetail) + "\",";
    j += "\"reasonCode\":" + String(g_disconnectBreadcrumbReasonCode) + ",";
    j += "\"atMs\":" + String(g_disconnectBreadcrumbAtMs) + ",";
    j += "\"ageMs\":" + String(breadcrumbAgeMs) + ",";
    j += "\"uptimeSeconds\":" + String(g_disconnectBreadcrumbUptimeS) + ",";
    j += "\"staRssi\":" + String(g_disconnectBreadcrumbStaRssi) + ",";
    j += "\"apClients\":" + String(g_disconnectBreadcrumbApClients) + ",";
    j += "\"freeHeapBytes\":" + String(g_disconnectBreadcrumbFreeHeap) + ",";
    j += "\"largestHeapBlockBytes\":" + String(g_disconnectBreadcrumbLargestHeapBlock) + ",";
    j += "\"httpRestartCount\":" + String(g_httpRestartCount);
    j += "},";
  }
  {
    const uint32_t freeHeap = controlPlaneFreeHeapBytes();
    const uint32_t minFreeHeap = esp_get_minimum_free_heap_size();
    const uint32_t largestHeapBlock = controlPlaneLargestHeapBlockBytes();
    const uint32_t internalFreeHeap = controlPlaneInternalFreeHeapBytes();
    const uint32_t internalLargestHeapBlock = controlPlaneInternalLargestHeapBlockBytes();
    const uint32_t playbackStackWords = g_playbackTaskHandle ? uxTaskGetStackHighWaterMark(g_playbackTaskHandle) : 0;
    const uint32_t playbackStackBytes = playbackStackWords * sizeof(StackType_t);
    const bool lowMemory = apiHeavyRouteUnderPressure();
    const bool stackTight = playbackStackBytes > 0 && playbackStackBytes < 3072;
    j += "\"mcu\":{";
    j += "\"freeHeapBytes\":" + String(freeHeap) + ",";
    j += "\"minFreeHeapBytes\":" + String(minFreeHeap) + ",";
    j += "\"largestHeapBlockBytes\":" + String(largestHeapBlock) + ",";
    j += "\"internalFreeHeapBytes\":" + String(internalFreeHeap) + ",";
    j += "\"internalLargestHeapBlockBytes\":" + String(internalLargestHeapBlock) + ",";
    j += "\"playbackStackHighWaterBytes\":" + String(playbackStackBytes) + ",";
    j += "\"lowMemory\":" + String(lowMemory ? "true" : "false") + ",";
    j += "\"stackTight\":" + String(stackTight ? "true" : "false");
    j += "},";
  }
  j += "\"ingestConfigured\":" + String(ingestIsConfigured() ? "true" : "false") + ",";
  j += "\"ingestState\":\"" + escJson(g_ingestState) + "\",";
  j += "\"ingestLastError\":\"" + escJson(g_ingestLastError) + "\",";
  j += "\"ingestLastFile\":\"" + escJson(g_ingestLastFile) + "\",";
  j += "\"ingestLastSessionId\":\"" + escJson(g_ingestLastSessionId) + "\",";
  j += "\"ingestLastAlbumId\":\"" + escJson(g_ingestLastAlbumId) + "\",";
  j += "\"ingestLastAt\":" + String(g_ingestLastAt) + ",";
  {
    const unsigned long capsuleOtaNextPollInMs =
      g_capsuleOtaNextPollAt > millis() ? (g_capsuleOtaNextPollAt - millis()) : 0;
    j += "\"capsuleOta\":{";
    j += "\"configured\":" + String(ingestIsConfigured() ? "true" : "false") + ",";
    j += "\"state\":\"" + escJson(g_capsuleOtaState) + "\",";
    j += "\"lastError\":\"" + escJson(g_capsuleOtaLastError) + "\",";
    j += "\"pendingCount\":" + String((unsigned long)g_capsuleOtaPendingCount) + ",";
    j += "\"unseenCount\":" + String((unsigned long)g_capsuleOtaUnseenCount) + ",";
    j += "\"deliveryId\":\"" + escJson(g_capsuleOtaPendingDeliveryId) + "\",";
    j += "\"capsuleId\":\"" + escJson(g_capsuleOtaPendingCapsuleId) + "\",";
    j += "\"title\":\"" + escJson(g_capsuleOtaPendingTitle) + "\",";
    j += "\"installPath\":\"" + escJson(g_capsuleOtaPendingInstallPath) + "\",";
    j += "\"downloadUrl\":\"" + escJson(g_capsuleOtaPendingDownloadUrl) + "\",";
    j += "\"ledIntent\":\"" + escJson(g_capsuleOtaPendingLedIntent) + "\",";
    j += "\"lastInstalledAtMs\":" + String(g_capsuleOtaLastInstalledAtMs) + ",";
    j += "\"lastPollAtMs\":" + String(g_capsuleOtaLastPollAt) + ",";
    j += "\"lastChangeAtMs\":" + String(g_capsuleOtaLastChangeAt) + ",";
    j += "\"nextPollInMs\":" + String(capsuleOtaNextPollInMs);
    j += "},";
  }
  j += "\"uptime_s\":" + String(uptime) + ",";
  j += "\"battery\":{\"present\":" + String(g_battPresent ? "true" : "false") + ",";
  j += "\"voltage\":" + String(g_battVoltage, 2) + ",";
  j += "\"percent\":" + String(g_battPercent) + ",";
  j += "\"charging\":" + String(g_charging ? "true" : "false") + "},";
  j += "\"audio\":{\"volume\":" + String(g_volume) + ",";
  j += "\"eq\":\"" + escJson(eqGetSelectedPreset()) + "\",";
  j += "\"width\":\"" + escJson(eqGetStereoWidthMode()) + "\",";
  j += "\"mode\":\"" + g_playMode + "\",";
  j += "\"a2dp\":\"disconnected\",\"a2dpDevice\":\"\"},";
  if (g_sdMounted) {
    j += "\"storage\":{\"totalMB\":" + String(g_sdTotalMB, 0) + ",";
    j += "\"usedMB\":" + String(g_sdUsedMB, 0) + ",";
    j += "\"freeMB\":" + String(g_sdFreeMB, 0) + ",";
  } else {
    j += "\"storage\":{\"totalMB\":0,\"usedMB\":0,\"freeMB\":0,";
  }
  j += "\"trackCount\":" + String(g_wavCount) + ",";
  j += "\"capsuleCount\":" + String(g_runtimeCapsuleCount) + ",\"videoCount\":1,";
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
  j += "\"idle\":{\"color\":\"" + g_ledIdle + "\",\"pattern\":\"" + g_ledIdlePat + "\",\"fullSpectrum\":" + String(g_ledIdleFullSpectrum ? "true" : "false") + "},";
  j += "\"playback\":{\"color\":\"" + g_ledPlay + "\",\"pattern\":\"" + g_ledPlayPat + "\",\"fullSpectrum\":" + String(g_ledPlayFullSpectrum ? "true" : "false") + "},";
  j += "\"charging\":{\"color\":\"" + g_ledCharge + "\",\"pattern\":\"" + g_ledChargePat + "\",\"fullSpectrum\":" + String(g_ledChargeFullSpectrum ? "true" : "false") + "},";
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

String jsonScalarVal(const String& body, const String& key) {
  String search = "\"" + key + "\"";
  int idx = body.indexOf(search);
  if (idx < 0) return "";
  int colon = body.indexOf(':', idx + search.length());
  if (colon < 0) return "";

  int start = colon + 1;
  while (start < (int)body.length()) {
    char c = body.charAt(start);
    if (c == ' ' || c == '\n' || c == '\r' || c == '\t') {
      start++;
      continue;
    }
    break;
  }
  if (start >= (int)body.length()) return "";

  if (body.charAt(start) == '"') {
    int qEnd = body.indexOf('"', start + 1);
    if (qEnd < 0) return "";
    return body.substring(start + 1, qEnd);
  }

  int end = start;
  while (end < (int)body.length()) {
    char c = body.charAt(end);
    if (c == ',' || c == '}' || c == ']' ||
        c == ' ' || c == '\n' || c == '\r' || c == '\t') {
      break;
    }
    end++;
  }
  return body.substring(start, end);
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

// upsertRuntimeCapsule logic now inlined in POST /api/capsule handler
// to support the extended RuntimeCapsule struct (price, ctaLabel, etc.)

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
  auto& statusHandler = server.on("/api/status", HTTP_GET, [](AsyncWebServerRequest* req) {
    notePortalHttpActivity();
    AsyncWebServerResponse* response = req->beginResponse(200, "application/json", buildStatusJson());
    response->addHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    response->addHeader("Pragma", "no-cache");
    response->addHeader("Connection", "close");
    req->send(response);
  });
  attachChurnGuards(statusHandler, 16, 4);

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
      const int nextVolume = constrain(req->getParam("level")->value().toInt(), 0, 100);
      if (nextVolume != g_volume) {
        g_volume = nextVolume;
        Serial.printf("[API] Volume -> %d\n", g_volume);
        // Persist to NVS so volume survives reboot, but keep flash writes off the hot path.
        persistLedStateSafely("volume");
      }
    }
    req->send(200, "application/json", "{\"ok\":true,\"volume\":" + String(g_volume) + "}");
  });

  // ── GET /api/eq/custom?bass=X&mid=X&treble=X (dB, ±6 range) ──
  // NOTE: Must be registered BEFORE /api/eq to avoid prefix matching against
  // the broader route and returning the preset list instead of custom values.
  server.on("/api/eq/custom", HTTP_GET, [](AsyncWebServerRequest* req) {
    float bass = eqGetCustomBassDB();
    float mid = eqGetCustomMidDB();
    float treble = eqGetCustomTrebleDB();
    const bool hasBass = req->hasParam("bass");
    const bool hasMid = req->hasParam("mid");
    const bool hasTreble = req->hasParam("treble");
    const bool shouldUpdate = hasBass || hasMid || hasTreble;

    if (hasBass) bass = req->getParam("bass")->value().toFloat();
    if (hasMid) mid = req->getParam("mid")->value().toFloat();
    if (hasTreble) treble = req->getParam("treble")->value().toFloat();

    if (shouldUpdate) {
      g_eq = "custom";
      uint32_t sr = (g_audioPlaying && g_wavSampleRate > 0) ? g_wavSampleRate : 44100;
      eqSetCustom(bass, mid, treble, sr);
      Serial.printf("[API] EQ custom: bass=%.1f mid=%.1f treble=%.1f\n", bass, mid, treble);
    } else {
      bass = eqGetCustomBassDB();
      mid = eqGetCustomMidDB();
      treble = eqGetCustomTrebleDB();
    }

    String j = "{\"ok\":true,\"eq\":\"" + escJson(eqGetActivePreset()) + "\",\"bass\":" + String(bass,1) + ",\"mid\":" + String(mid,1) + ",\"treble\":" + String(treble,1) + "}";
    req->send(200, "application/json", j);
  });

  // ── GET /api/eq?preset=X ─────────────────────────────────────
  server.on("/api/eq", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (req->hasParam("preset")) {
      String preset = req->getParam("preset")->value();
      if (!eqIsValidPreset(preset)) {
        req->send(400, "application/json", "{\"ok\":false,\"error\":\"invalid_eq_preset\"}");
        return;
      }
      String canonical = eqCanonicalPreset(preset);
      uint32_t sr = g_wavSampleRate > 0 ? g_wavSampleRate : 44100;
      eqSetPreset(canonical, sr);
      Serial.printf("[API] EQ -> %s\n", canonical.c_str());
      req->send(200, "application/json", "{\"ok\":true,\"eq\":\"" + escJson(canonical) + "\"}");
    } else {
      String j = "{\"eq\":\"" + escJson(eqGetSelectedPreset()) + "\",\"presets\":[";
      j += "\"flat\",\"dpa_signature\",\"hip_hop\",\"pop\",\"vocal\"";
      j += "]}";
      req->send(200, "application/json", j);
    }
  });

  // ── GET /api/audio/stereo-width?mode=off|enhanced ─────────────
  server.on("/api/audio/stereo-width", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (req->hasParam("mode")) {
      String mode = req->getParam("mode")->value();
      mode.trim();
      mode.toLowerCase();
      if (mode != "off" && mode != "enhanced") {
        req->send(400, "application/json", "{\"ok\":false,\"error\":\"invalid_stereo_width_mode\"}");
        return;
      }
      eqSetStereoWidthMode(mode);
      Serial.printf("[API] Stereo width -> %s\n", eqGetStereoWidthMode().c_str());
      req->send(200, "application/json",
        "{\"ok\":true,\"width\":\"" + escJson(eqGetStereoWidthMode()) + "\"}");
      return;
    }

    String j = "{\"width\":\"" + escJson(eqGetStereoWidthMode()) + "\",\"modes\":[\"off\",\"enhanced\"]}";
    req->send(200, "application/json", j);
  });

  // ── GET /api/audio/output-gain ───────────────────────────────
  server.on("/api/audio/output-gain", HTTP_GET, [](AsyncWebServerRequest* req) {
    (void)req;
    String j = "{";
    j += "\"ok\":true,";
    j += "\"selectedEq\":\"" + escJson(eqGetSelectedPreset()) + "\",";
    j += "\"activeEq\":\"" + escJson(eqGetActivePreset()) + "\",";
    j += "\"volume\":" + String(g_volume) + ",";
    j += "\"volumeScalar\":" + String(g_dspTelemetryVolumeScalar, 3) + ",";
    j += "\"preampDb\":" + String(g_dspTelemetryPreampDb, 2) + ",";
    j += "\"masterCalibrationDb\":" + String(g_dspTelemetryMasterGainDb, 2) + ",";
    j += "\"outputTrimDb\":" + String(g_dspTelemetryOutputTrimDb, 2) + ",";
    j += "\"limiterThresholdNorm\":" + String(kLimiterThresholdNorm, 3) + ",";
    j += "\"peakPreLimiterNorm\":" + String(g_dspTelemetryPeakPreLimiterNorm, 3) + ",";
    j += "\"peakPostLimiterNorm\":" + String(g_dspTelemetryPeakPostLimiterNorm, 3) + ",";
    j += "\"limiterReductionDb\":" + String(g_dspTelemetryLimiterReductionDb, 2) + ",";
    j += "\"limiterEvents\":" + String((unsigned long)g_dspTelemetryLimiterEvents);
    j += "}";
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
      if (g_favCount < MAX_TRACKS) {
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
    ledNotify(nowLiked ? "#5c0000" : "#444444", "heartbeat", 700);
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
    ledNotify(nowLiked ? "#5c0000" : "#444444", "heartbeat", 700);
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
    if (apiHeavyRouteUnderPressure() && (g_audioPlaying || g_uploadInProgress)) {
      sendDeferredFeatures(req);
      return;
    }
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
    if (apiRejectHeavyRequest(req, "analytics")) return;
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
    if (apiRejectHeavyRequest(req, "tracks")) return;
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

  // ── GET /api/art?path=/art/cover.jpg ───────────────────────
  // Serves album + per-track artwork from SD (/art/). Portal pushes here.
  server.on("/api/art", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (apiRejectHeavyRequest(req, "art")) return;
    if (!req->hasParam("path")) {
      req->send(400, "application/json", "{\"error\":\"path required\"}");
      return;
    }
    String resolved;
    if (!resolveArtRequestPath(req->getParam("path")->value(), resolved)) {
      req->send(400, "application/json", "{\"error\":\"invalid path\"}");
      return;
    }
    sendArtFromSd(req, resolved);
  });
  server.on("/api/art", HTTP_OPTIONS, [](AsyncWebServerRequest* req) {
    AsyncWebServerResponse* response = req->beginResponse(204);
    response->addHeader("Access-Control-Allow-Origin", "*");
    response->addHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    response->addHeader("Access-Control-Allow-Headers", "Content-Type, Cache-Control, Pragma");
    req->send(response);
  });
  server.on("/api/art-exists", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!req->hasParam("path")) {
      req->send(400, "application/json", "{\"error\":\"path required\"}");
      return;
    }
    String resolved;
    if (!resolveArtRequestPath(req->getParam("path")->value(), resolved)) {
      req->send(400, "application/json", "{\"error\":\"invalid path\"}");
      return;
    }
    sendArtExistsJson(req, resolved);
  });
  server.on("/api/art-exists", HTTP_OPTIONS, [](AsyncWebServerRequest* req) {
    AsyncWebServerResponse* response = req->beginResponse(204);
    response->addHeader("Access-Control-Allow-Origin", "*");
    response->addHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    response->addHeader("Access-Control-Allow-Headers", "Content-Type, Cache-Control, Pragma");
    req->send(response);
  });

  // ── GET /api/booklet ─────────────────────────────────────────
  server.on("/api/booklet", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (apiRejectHeavyRequest(req, "booklet")) return;
    sendJsonFromSd(req, BOOKLET_PATH);
  });
  server.on("/api/booklet", HTTP_OPTIONS, [](AsyncWebServerRequest* req) {
    AsyncWebServerResponse* response = req->beginResponse(204);
    response->addHeader("Access-Control-Allow-Origin", "*");
    response->addHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    response->addHeader("Access-Control-Allow-Headers", "Content-Type, Cache-Control, Pragma");
    req->send(response);
  });

  // ── GET /api/album/meta ──────────────────────────────────────
  server.on("/api/album/meta", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (apiRejectHeavyRequest(req, "album_meta")) return;
    sendJsonFromSd(req, ALBUM_META_PATH);
  });
  server.on("/api/album/meta", HTTP_OPTIONS, [](AsyncWebServerRequest* req) {
    AsyncWebServerResponse* response = req->beginResponse(204);
    response->addHeader("Access-Control-Allow-Origin", "*");
    response->addHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    response->addHeader("Access-Control-Allow-Headers", "Content-Type, Cache-Control, Pragma");
    req->send(response);
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
  // Multipart upload — persistent file handle + 8KB buffered writes (matches DPAC uploader pattern)
  static File g_mpUploadFile;
  static String g_mpUploadFinalPath;
  static String g_mpUploadTempPath;
  static size_t g_mpBytesWritten = 0;
  static bool g_mpWriteError = false;
  static const size_t MP_STAGE_SIZE = 8192;
  static uint8_t g_mpStageBuf[MP_STAGE_SIZE];
  static size_t g_mpStageUsed = 0;

  server.on("/api/sd/upload", HTTP_POST,
    [](AsyncWebServerRequest* req) {
      // Flush remaining staged bytes
      if (g_mpUploadFile && g_mpStageUsed > 0 && !g_mpWriteError) {
        size_t w = g_mpUploadFile.write(g_mpStageBuf, g_mpStageUsed);
        if (w == g_mpStageUsed) g_mpBytesWritten += w;
        else g_mpWriteError = true;
        g_mpStageUsed = 0;
      }
      if (g_mpUploadFile) {
        g_mpUploadFile.flush();
        g_mpUploadFile.close();
      }

      bool ok = false;
      if (!g_mpWriteError && g_mpBytesWritten > 0 && SD.exists(g_mpUploadTempPath)) {
        if (SD.exists(g_mpUploadFinalPath)) SD.remove(g_mpUploadFinalPath);
        ok = SD.rename(g_mpUploadTempPath, g_mpUploadFinalPath);
        Serial.printf("[SD] Upload finalized: %s (%u bytes, rename=%s)\n",
          g_mpUploadFinalPath.c_str(), (unsigned)g_mpBytesWritten, ok ? "OK" : "FAIL");
      } else {
        Serial.printf("[SD] Upload FAILED: writeErr=%d bytes=%u\n",
          g_mpWriteError, (unsigned)g_mpBytesWritten);
        if (SD.exists(g_mpUploadTempPath)) SD.remove(g_mpUploadTempPath);
      }

      // Upload done — resume background tasks
      extern volatile bool g_uploadInProgress;
      g_uploadInProgress = false;

      // Remount fast for playback + rescan
      sdMountFast();
      sdRefreshStats();
      scanWavList();
      String j = "{\"ok\":" + String(ok ? "true" : "false") + ",\"freeMB\":" + String(g_sdFreeMB, 0) + "}";
      req->send(200, "application/json", j);
    },
    [](AsyncWebServerRequest* req, const String& filename, size_t index, uint8_t* data, size_t len, bool final) {
      if (!g_sdMounted) return;

      if (index == 0) {
        if (g_audioPlaying) { audioStop(); delay(100); }

        // Match DPAC uploader: disable WiFi sleep to prevent SPI bus contention
        WiFi.setSleep(false);

        sdMountSlow();

        String rawPath = req->hasParam("path") ? req->getParam("path")->value() : ("/tracks/" + filename);
        g_mpUploadFinalPath = sanitizePath(rawPath);
        g_mpUploadTempPath = g_mpUploadFinalPath + ".part";

        String dir = g_mpUploadFinalPath.substring(0, g_mpUploadFinalPath.lastIndexOf('/'));
        if (dir.length() > 0 && !SD.exists(dir)) SD.mkdir(dir);

        if (SD.exists(g_mpUploadTempPath)) SD.remove(g_mpUploadTempPath);
        if (SD.exists(g_mpUploadFinalPath)) SD.remove(g_mpUploadFinalPath);

        g_mpUploadFile = SD.open(g_mpUploadTempPath, FILE_WRITE);
        g_mpBytesWritten = 0;
        g_mpWriteError = false;
        g_mpStageUsed = 0;

        if (!g_mpUploadFile) {
          g_mpWriteError = true;
          Serial.printf("[SD] Upload OPEN FAILED: %s\n", g_mpUploadTempPath.c_str());
        } else {
          extern volatile bool g_uploadInProgress;
          g_uploadInProgress = true;
          Serial.printf("[SD] Upload start: %s (%s)\n", g_mpUploadFinalPath.c_str(), filename.c_str());
        }
      }

      if (g_mpUploadFile && !g_mpWriteError) {
        size_t offset = 0;
        while (offset < len) {
          size_t space = MP_STAGE_SIZE - g_mpStageUsed;
          size_t toCopy = min(space, len - offset);
          memcpy(g_mpStageBuf + g_mpStageUsed, data + offset, toCopy);
          g_mpStageUsed += toCopy;
          offset += toCopy;

          if (g_mpStageUsed == MP_STAGE_SIZE) {
            size_t w = 0;
            int retries = 0;
            while (w < MP_STAGE_SIZE && retries < 4) {
              size_t chunk = min(MP_STAGE_SIZE - w, (size_t)8192);
              size_t wrote = g_mpUploadFile.write(g_mpStageBuf + w, chunk);
              if (wrote > 0) { w += wrote; retries = 0; }
              else { retries++; delay(10); }
            }
            if (w == MP_STAGE_SIZE) {
              g_mpBytesWritten += w;
            } else {
              g_mpWriteError = true;
              Serial.printf("[SD] Upload WRITE FAILED at %u bytes\n", (unsigned)g_mpBytesWritten);
            }
            g_mpStageUsed = 0;
          }
        }

        if ((index + len) % 524288 < len) {
          Serial.printf("[SD] Upload: %u bytes written\n", (unsigned)(g_mpBytesWritten + g_mpStageUsed));
        }
      }

      if (final && g_mpUploadFile) {
        Serial.printf("[SD] Upload received: %u bytes total (staged=%u)\n",
          (unsigned)(index + len), (unsigned)g_mpStageUsed);
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
        String rawPath = req->hasParam("path") ? req->getParam("path")->value() : "/upload.bin";
        g_uploadPath = sanitizePath(rawPath);
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

  // ── DELETE or GET /api/sd/delete?path=/file.wav ── [ADMIN]
  // GET alias avoids CORS preflight from cross-origin portals.
  auto sdDeleteHandler = [](AsyncWebServerRequest* req) {
    if (!g_adminMode) {
      auto* r = req->beginResponse(403, "application/json", "{\"error\":\"admin mode required\"}");
      r->addHeader("Access-Control-Allow-Origin", "*");
      req->send(r);
      return;
    }
    if (!g_sdMounted) {
      auto* r = req->beginResponse(503, "application/json", "{\"error\":\"sd not mounted\"}");
      r->addHeader("Access-Control-Allow-Origin", "*");
      req->send(r);
      return;
    }
    if (!req->hasParam("path")) {
      auto* r = req->beginResponse(400, "application/json", "{\"error\":\"path required\"}");
      r->addHeader("Access-Control-Allow-Origin", "*");
      req->send(r);
      return;
    }
    String path = req->getParam("path")->value();
    bool ok = SD.remove(path);
    Serial.printf("[SD] Delete %s: %s\n", path.c_str(), ok ? "ok" : "failed");
    sdRefreshStats();
    if (path.startsWith("/tracks/")) {
      scanWavList();
    }
    auto* r = req->beginResponse(200, "application/json", "{\"ok\":" + String(ok ? "true" : "false") + "}");
    r->addHeader("Access-Control-Allow-Origin", "*");
    req->send(r);
  };
  server.on("/api/sd/delete", HTTP_DELETE, sdDeleteHandler);
  server.on("/api/sd/delete", HTTP_GET, sdDeleteHandler);
  server.on("/api/sd/delete", HTTP_OPTIONS, [](AsyncWebServerRequest* req) {
    AsyncWebServerResponse* response = req->beginResponse(204);
    response->addHeader("Access-Control-Allow-Origin", "*");
    response->addHeader("Access-Control-Allow-Methods", "GET, DELETE, OPTIONS");
    response->addHeader("Access-Control-Allow-Headers", "Content-Type, Cache-Control, Pragma");
    req->send(response);
  });

  // ── GET /api/storage ───────────────────────────────────────
  // Returns cached stats (always fast). Only refreshes if not playing.
  auto& storageHandler = server.on("/api/storage", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (apiRejectHeavyRequest(req, "storage")) return;
    const bool heavyStorageSuppressed = g_audioPlaying || g_uploadInProgress || apiHeavyRouteUnderPressure();
    sdRefreshStats();  // No-op during playback, uses cached values
    String j = "{\"sdMounted\":" + String(g_sdMounted ? "true" : "false") + ",";
    j += "\"totalMB\":" + String(g_sdTotalMB, 0) + ",";
    j += "\"usedMB\":" + String(g_sdUsedMB, 0) + ",";
    j += "\"freeMB\":" + String(g_sdFreeMB, 0) + ",";
    j += "\"trackCount\":" + String(g_wavCount) + ",";
    j += "\"capsuleCount\":" + String(g_runtimeCapsuleCount) + ",\"videoCount\":1,";
    j += "\"sdSpeed\":" + String(g_sdCurrentHz) + ",";
    j += "\"files\":";
    j += heavyStorageSuppressed ? "[]" : sdListFilesJson("/tracks");
    j += "}";
    req->send(200, "application/json", j);
  });
  attachChurnGuards(storageHandler, 4, 4);

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
  // Returns ONLY real pushed capsules (no mock data)
  auto& capsulesHandler = server.on("/api/capsules", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (apiRejectHeavyRequest(req, "capsules")) return;
    String j = "{\"capsules\":[";
    for (int i = 0; i < g_runtimeCapsuleCount; i++) {
      if (i > 0) j += ",";
      j += "{\"id\":\"" + escJson(g_runtimeCapsules[i].id) + "\",";
      j += "\"type\":\"" + escJson(g_runtimeCapsules[i].type) + "\",";
      j += "\"title\":\"" + escJson(g_runtimeCapsules[i].title) + "\",";
      j += "\"desc\":\"" + escJson(g_runtimeCapsules[i].desc) + "\",";
      j += "\"date\":\"" + escJson(g_runtimeCapsules[i].date) + "\",";
      j += "\"delivered\":" + String(g_runtimeCapsules[i].delivered ? "true" : "false") + ",";
      j += "\"version\":" + String(g_runtimeCapsules[i].version) + ",";
      j += "\"seen\":" + String(g_runtimeCapsules[i].seen ? "true" : "false") + ",";
      j += "\"price\":" + String(g_runtimeCapsules[i].price, 2) + ",";
      j += "\"ctaLabel\":\"" + escJson(g_runtimeCapsules[i].ctaLabel) + "\",";
      j += "\"ctaUrl\":\"" + escJson(g_runtimeCapsules[i].ctaUrl) + "\",";
      j += "\"hasImage\":" + String(g_runtimeCapsules[i].hasImage ? "true" : "false") + ",";
      j += "\"localPath\":\"" + escJson(g_runtimeCapsules[i].localPath) + "\",";
      j += "\"deliveryId\":\"" + escJson(g_runtimeCapsules[i].deliveryId) + "\",";
      j += "\"source\":\"" + escJson(g_runtimeCapsules[i].source) + "\"}";
    }
    j += "]}";
    req->send(200, "application/json", j);
  });
  attachChurnGuards(capsulesHandler, 3, 4);
  server.on("/api/capsules", HTTP_OPTIONS, [](AsyncWebServerRequest* req) {
    AsyncWebServerResponse* response = req->beginResponse(204);
    response->addHeader("Access-Control-Allow-Origin", "*");
    response->addHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    response->addHeader("Access-Control-Allow-Headers", "Content-Type, Cache-Control, Pragma");
    req->send(response);
  });

  server.on("/api/capsule/seen", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!req->hasParam("id")) {
      req->send(400, "application/json", "{\"ok\":false,\"error\":\"id required\"}");
      return;
    }
    const String capsuleId = req->getParam("id")->value();
    bool changed = markRuntimeCapsuleSeenAndSave(capsuleId);
    bool reported = capsuleOtaAckSeen(capsuleId);
    String j = "{\"ok\":true,\"id\":\"" + escJson(capsuleId) + "\"";
    j += ",\"seen\":" + String(changed ? "true" : "false");
    j += ",\"reported\":" + String(reported ? "true" : "false") + "}";
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
      String priceStr = jsonScalarVal(body, "price");
      float price = priceStr.length() > 0 ? priceStr.toFloat() : 0;
      String ctaLabel = jsonVal(body, "ctaLabel");
      String ctaUrl   = jsonVal(body, "ctaUrl");
      bool hasImage   = jsonBool(body, "hasImage", false);
      upsertRuntimeCapsuleRecord(
        capsuleId,
        eventType,
        title,
        desc,
        date,
        delivered,
        1,
        false,
        price,
        ctaLabel,
        ctaUrl,
        hasImage,
        "",
        "",
        "wifi"
      );
      triggerCapsuleLedNotification(eventType);

      Serial.printf("[CAPSULE] Ingested + saved id=%s type=%s title=%s price=%.2f\n",
        capsuleId.c_str(), eventType.c_str(), title.c_str(), price);

      String j = "{\"ok\":true,\"id\":\"" + escJson(capsuleId) + "\"}";
      req->send(200, "application/json", j);
    }
  );

  // ── GET /api/led/preview ─────────────────────────────────────
  // Sets color/pattern and switches the active LED mode to match
  server.on("/api/led/preview", HTTP_GET, [](AsyncWebServerRequest* req) {
    LedMode targetMode = LED_IDLE;
    bool explicitFullSpectrum = false;
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
    if (req->hasParam("fullSpectrum")) {
      String full = req->getParam("fullSpectrum")->value();
      full.toLowerCase();
      explicitFullSpectrum = !(full == "0" || full == "false" || full == "off" || full == "no");
      ledSetModeFullSpectrum(targetMode, explicitFullSpectrum);
    } else if (req->hasParam("color") || req->hasParam("gradEnd")) {
      ledSetModeFullSpectrum(targetMode, false);
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
  auto& wifiStatusHandler = server.on("/api/wifi/status", HTTP_GET, [](AsyncWebServerRequest* req) {
    String j = "{\"ap\":{\"ssid\":\"" + escJson(g_apSSID) + "\",\"ip\":\"" + WiFi.softAPIP().toString() + "\",\"clients\":" + String(WiFi.softAPgetStationNum()) + "},";
    j += "\"sta\":{\"connected\":" + String(g_staConnected ? "true" : "false");
    j += ",\"ssid\":\"" + escJson(g_staSSID) + "\"";
    j += ",\"ip\":\"" + g_staIP + "\"";
    j += ",\"rssi\":" + String(g_staRSSI);
    j += ",\"joinPending\":" + String(g_staJoinPending ? "true" : "false") + "}}";
    req->send(200, "application/json", j);
  });
  attachChurnGuards(wifiStatusHandler, 6, 4);

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

    if (g_staJoinPending) {
      String j = "{\"pending\":true,\"ssid\":\"" + escJson(g_staSSID) + "\"}";
      req->send(200, "application/json", j);
      return;
    }

    if (g_staConnected) {
      wifiDisconnectSTA();
    }

    g_staSSID = req->getParam("ssid")->value();
    g_staPassword = req->hasParam("pass") ? req->getParam("pass")->value() : "";

    g_staJoinPending = true;
    g_staJoinQueued = true;

    String j = "{\"pending\":true,\"ssid\":\"" + escJson(g_staSSID) + "\"}";
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

  // ── GET /api/ingest/config?base=X&token=Y ─────────── [ADMIN]
  server.on("/api/ingest/config", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!g_adminMode) {
      req->send(403, "application/json", "{\"error\":\"admin mode required\"}");
      return;
    }
    if (!req->hasParam("base") || !req->hasParam("token")) {
      req->send(400, "application/json", "{\"error\":\"base and token required\"}");
      return;
    }
    String base = req->getParam("base")->value();
    String token = req->getParam("token")->value();
    ingestSetConfig(base, token);
    req->send(200, "application/json", "{\"ok\":true,\"configured\":true}");
  });

  // ── GET /api/ingest/clear ─────────────────────────── [ADMIN]
  server.on("/api/ingest/clear", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!g_adminMode) {
      req->send(403, "application/json", "{\"error\":\"admin mode required\"}");
      return;
    }
    ingestClearConfig();
    req->send(200, "application/json", "{\"ok\":true,\"configured\":false}");
  });

  // ── GET /api/ingest/push?path=X&albumId=Y&kind=Z ─── [ADMIN]
  server.on("/api/ingest/push", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!g_adminMode) {
      req->send(403, "application/json", "{\"error\":\"admin mode required\"}");
      return;
    }
    if (!req->hasParam("path")) {
      req->send(400, "application/json", "{\"error\":\"path required\"}");
      return;
    }
    String sdPath = req->getParam("path")->value();
    String albumId = req->hasParam("albumId") ? req->getParam("albumId")->value() : "";
    String kind = req->hasParam("kind") ? req->getParam("kind")->value() : "support";
    bool ok = ingestPushFile(sdPath, albumId, kind);
    String j = "{\"ok\":" + String(ok ? "true" : "false");
    j += ",\"state\":\"" + escJson(g_ingestState) + "\"";
    j += ",\"lastError\":\"" + escJson(g_ingestLastError) + "\"";
    j += ",\"lastSessionId\":\"" + escJson(g_ingestLastSessionId) + "\"}";
    req->send(ok ? 200 : 500, "application/json", j);
  });

  // ── POST /api/theme ────────────────────────────────────────
  server.on("/api/theme", HTTP_POST,
    [](AsyncWebServerRequest* req) {},
    NULL,
    [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
      String body = "";
      for (size_t i = 0; i < len; i++) body += (char)data[i];

      Serial.println("[THEME] Received: " + body);

      bool changed = false;
      String v;
      v = jsonVal(body, "idle_color");     if (v.length() && v != g_ledIdle) { g_ledIdle = v; changed = true; }
      v = jsonVal(body, "idle_pattern");   if (v.length() && v != g_ledIdlePat) { g_ledIdlePat = v; changed = true; }
      v = jsonVal(body, "play_color");     if (v.length() && v != g_ledPlay) { g_ledPlay = v; changed = true; }
      v = jsonVal(body, "play_pattern");   if (v.length() && v != g_ledPlayPat) { g_ledPlayPat = v; changed = true; }
      v = jsonVal(body, "charge_color");   if (v.length() && v != g_ledCharge) { g_ledCharge = v; changed = true; }
      v = jsonVal(body, "charge_pattern"); if (v.length() && v != g_ledChargePat) { g_ledChargePat = v; changed = true; }
      v = jsonVal(body, "grad_end");       if (v.length() && v != g_ledGradEnd) { g_ledGradEnd = v; changed = true; }
      if (!v.length()) {
        v = jsonVal(body, "gradEnd");
        if (v.length() && v != g_ledGradEnd) { g_ledGradEnd = v; changed = true; }
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
            const int nextBrightness = constrain(bStr.toInt(), 0, 100);
            if (nextBrightness != g_brightness) {
              g_brightness = nextBrightness;
              changed = true;
            }
          }
        }
      }

      v = jsonVal(body, "dcnp_concert"); if (v.length() && v != g_dcnpConcert) { g_dcnpConcert = v; changed = true; }
      v = jsonVal(body, "dcnp_video");   if (v.length() && v != g_dcnpVideo) { g_dcnpVideo = v; changed = true; }
      v = jsonVal(body, "dcnp_merch");   if (v.length() && v != g_dcnpMerch) { g_dcnpMerch = v; changed = true; }
      v = jsonVal(body, "dcnp_signing"); if (v.length() && v != g_dcnpSigning) { g_dcnpSigning = v; changed = true; }
      v = jsonVal(body, "dcnp_remix");   if (v.length() && v != g_dcnpRemix) { g_dcnpRemix = v; changed = true; }
      v = jsonVal(body, "dcnp_other");   if (v.length() && v != g_dcnpOther) { g_dcnpOther = v; changed = true; }

      // Update SSID metadata if artist/album provided
      String artist = jsonVal(body, "artist");
      String album = jsonVal(body, "album");
      if (artist.length() > 0 || album.length() > 0) {
        wifiSetMetadata(artist, album);
      }

      if (changed) {
        persistLedStateSafely("theme");
        if (g_audioPlaying || g_uploadInProgress) {
          Serial.println("[THEME] Applied in RAM; save deferred");
        } else {
          Serial.println("[THEME] Applied & saved");
        }
      } else {
        Serial.println("[THEME] No effective change");
      }

      req->send(200, "application/json", "{\"ok\":true}");
    }
  );

  // ── GET /api/playlist/order — return current track order ────
  server.on("/api/playlist/order", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (apiRejectHeavyRequest(req, "playlist_order")) return;
    notePortalHttpActivity();
    String json = "[";
    for (int i = 0; i < g_wavCount; i++) {
      if (i > 0) json += ",";
      json += "\"" + escJson(g_wavPaths[i]) + "\"";
    }
    json += "]";
    req->send(200, "application/json", "{\"order\":" + json + "}");
  });

  // ── POST /api/playlist/order — set track order from portal ──
  server.on("/api/playlist/order", HTTP_POST,
    [](AsyncWebServerRequest* req) {},
    NULL,
    [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
      if (!g_adminMode) {
        req->send(403, "application/json", "{\"error\":\"admin mode required\"}");
        return;
      }
      String body = "";
      for (size_t i = 0; i < len; i++) body += (char)data[i];

      // Parse JSON array from {"order": [...]}
      int arrStart = body.indexOf('[');
      int arrEnd = body.lastIndexOf(']');
      if (arrStart < 0 || arrEnd < 0 || arrEnd <= arrStart) {
        req->send(400, "application/json", "{\"error\":\"invalid order array\"}");
        return;
      }

      static String ordered[MAX_TRACKS];
      int orderedCount = 0;
      String arr = body.substring(arrStart + 1, arrEnd);
      int pos = 0;
      while (pos < (int)arr.length() && orderedCount < MAX_TRACKS) {
        int qs = arr.indexOf('"', pos);
        if (qs < 0) break;
        int qe = arr.indexOf('"', qs + 1);
        if (qe < 0) break;
        ordered[orderedCount++] = arr.substring(qs + 1, qe);
        pos = qe + 1;
      }

      static String reordered[MAX_TRACKS];
      static bool used[MAX_TRACKS];
      for (int i = 0; i < g_wavCount; i++) used[i] = false;
      int newCount = 0;

      for (int o = 0; o < orderedCount; o++) {
        for (int w = 0; w < g_wavCount; w++) {
          if (!used[w] && g_wavPaths[w] == ordered[o]) {
            reordered[newCount++] = g_wavPaths[w];
            used[w] = true;
            break;
          }
        }
      }
      for (int w = 0; w < g_wavCount; w++) {
        if (!used[w]) reordered[newCount++] = g_wavPaths[w];
      }
      for (int i = 0; i < newCount; i++) g_wavPaths[i] = reordered[i];
      g_wavCount = newCount;
      audioInvalidateTracksJsonCache();
      savePlaylistOrder();

      String json = "[";
      for (int i = 0; i < g_wavCount; i++) {
        if (i > 0) json += ",";
        json += "\"" + escJson(g_wavPaths[i]) + "\"";
      }
      json += "]";
      req->send(200, "application/json", "{\"ok\":true,\"order\":" + json + "}");
    }
  );

  server.on("/api/playlist/order", HTTP_OPTIONS, [](AsyncWebServerRequest* req) {
    req->send(204, "", "");
  });
}

#endif // DPA_API_H
