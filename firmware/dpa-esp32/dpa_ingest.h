/*
 * Private DPAC ingest client
 * Device-side STA upload flow for operator-only storage.
 */

#ifndef DPA_INGEST_H
#define DPA_INGEST_H

#include <WiFi.h>
#include <Preferences.h>
#include <SD.h>
#include <mbedtls/sha256.h>

String g_ingestBaseUrl       = "";
String g_ingestDeviceToken   = "";
String g_ingestState         = "disabled";
String g_ingestLastError     = "";
String g_ingestLastFile      = "";
String g_ingestLastSessionId = "";
String g_ingestLastAlbumId   = "";
unsigned long g_ingestLastAt = 0;
String g_capsuleOtaState              = "disabled";
String g_capsuleOtaLastError          = "";
String g_capsuleOtaPendingDeliveryId  = "";
String g_capsuleOtaPendingCapsuleId   = "";
String g_capsuleOtaPendingTitle       = "";
String g_capsuleOtaPendingDesc        = "";
String g_capsuleOtaPendingType        = "";
String g_capsuleOtaPendingInstallPath = "";
String g_capsuleOtaPendingDownloadUrl = "";
String g_capsuleOtaPendingLedIntent   = "";
String g_capsuleOtaPendingSha256      = "";
uint32_t g_capsuleOtaPendingSizeBytes = 0;
int g_capsuleOtaPendingVersion        = 1;
uint32_t g_capsuleOtaPendingCount     = 0;
uint32_t g_capsuleOtaUnseenCount      = 0;
unsigned long g_capsuleOtaLastPollAt  = 0;
unsigned long g_capsuleOtaLastChangeAt = 0;
unsigned long g_capsuleOtaNextPollAt  = 0;
unsigned long g_capsuleOtaLastInstalledAtMs = 0;
static const unsigned long CAPSULE_OTA_POLL_IDLE_MS    = 300000UL;
static const unsigned long CAPSULE_OTA_POLL_PENDING_MS = 15000UL;
static const unsigned long CAPSULE_OTA_POLL_ERROR_MS   = 30000UL;
static const unsigned long CAPSULE_OTA_POLL_ACTIVE_MS  = 30000UL;
static const char* CAPSULE_OTA_INDEX_PATH = "/capsules/index.json";
static const size_t CAPSULE_OTA_PROGRESS_STEP_BYTES = 256 * 1024;

struct OtaInstalledCapsule {
  String capsuleId;
  int version;
  String deliveryId;
  String title;
  String type;
  String desc;
  String installedPath;
  String sha256;
  uint32_t sizeBytes;
  bool seen;
};

static OtaInstalledCapsule g_capsuleOtaInstalled[24];
static int g_capsuleOtaInstalledCount = 0;

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
);
bool markRuntimeCapsuleSeenAndSave(const String& capsuleId);
bool capsuleOtaAckSeen(const String& capsuleId);
void capsuleOtaLoadIndex();
void capsuleOtaCleanupStaleParts();
static void capsuleOtaProcessPendingDelivery();

static String ingestTrimmedBaseUrl() {
  String base = g_ingestBaseUrl;
  base.trim();
  while (base.endsWith("/")) base.remove(base.length() - 1);
  return base;
}

static String ingestUrlEncode(const String& value) {
  String out = "";
  const char* hex = "0123456789ABCDEF";
  for (size_t i = 0; i < value.length(); i++) {
    char c = value.charAt(i);
    bool safe = (c >= 'a' && c <= 'z') ||
                (c >= 'A' && c <= 'Z') ||
                (c >= '0' && c <= '9') ||
                c == '-' || c == '_' || c == '.' || c == '~' || c == '/';
    if (safe) {
      out += c;
    } else {
      out += '%';
      out += hex[(c >> 4) & 0x0F];
      out += hex[c & 0x0F];
    }
  }
  return out;
}

static int ingestSendJsonRequest(
  const String& method,
  const String& url,
  const String& body,
  const String& contentType,
  const String& authHeaderName,
  const String& authHeaderValue,
  String& responseBody
);

static String ingestEscJson(const String& value) {
  String out;
  out.reserve(value.length() + 8);
  for (size_t i = 0; i < value.length(); i++) {
    char c = value.charAt(i);
    switch (c) {
      case '"':  out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) out += ' ';
        else out += c;
        break;
    }
  }
  return out;
}

static String ingestJsonVal(const String& body, const String& key) {
  String needle = "\"" + key + "\"";
  int idx = body.indexOf(needle);
  if (idx < 0) return "";
  int colon = body.indexOf(':', idx + needle.length());
  if (colon < 0) return "";

  int start = colon + 1;
  while (start < (int)body.length() && (body.charAt(start) == ' ' || body.charAt(start) == '\"')) start++;

  bool quoted = body.charAt(colon + 1) == '\"' || body.charAt(start - 1) == '\"';
  String value = "";
  if (quoted) {
    for (int i = start; i < (int)body.length(); i++) {
      char c = body.charAt(i);
      if (c == '\"' && body.charAt(i - 1) != '\\') break;
      value += c;
    }
    return value;
  }

  for (int i = start; i < (int)body.length(); i++) {
    char c = body.charAt(i);
    if (c == ',' || c == '}' || c == '\n' || c == '\r') break;
    value += c;
  }
  value.trim();
  return value;
}

static void ingestApplyState(const String& nextState, const String& error = "") {
  g_ingestState = nextState;
  g_ingestLastError = error;
  g_ingestLastAt = millis();
}

static void capsuleOtaApplyState(const String& nextState, const String& error = "") {
  g_capsuleOtaState = nextState;
  g_capsuleOtaLastError = error;
  g_capsuleOtaLastChangeAt = millis();
}

static void capsuleOtaResetPending() {
  g_capsuleOtaPendingCount = 0;
  g_capsuleOtaPendingDeliveryId = "";
  g_capsuleOtaPendingCapsuleId = "";
  g_capsuleOtaPendingTitle = "";
  g_capsuleOtaPendingDesc = "";
  g_capsuleOtaPendingType = "";
  g_capsuleOtaPendingInstallPath = "";
  g_capsuleOtaPendingDownloadUrl = "";
  g_capsuleOtaPendingLedIntent = "";
  g_capsuleOtaPendingSha256 = "";
  g_capsuleOtaPendingSizeBytes = 0;
  g_capsuleOtaPendingVersion = 1;
}

static bool capsuleOtaIsConfigured() {
  return ingestTrimmedBaseUrl().length() > 0 && g_ingestDeviceToken.length() > 0;
}

static void capsuleOtaScheduleNextPoll(unsigned long delayMs) {
  g_capsuleOtaNextPollAt = millis() + delayMs;
}

static String capsuleOtaAlbumIdsJson() {
  String albumId = wifiGetAlbum();
  albumId.trim();
  if (albumId.length() == 0) return "[]";
  return "[\"" + ingestEscJson(albumId) + "\"]";
}

static int capsuleOtaFindInstalledIndex(const String& capsuleId, int version = -1) {
  for (int i = 0; i < g_capsuleOtaInstalledCount; i++) {
    if (g_capsuleOtaInstalled[i].capsuleId != capsuleId) continue;
    if (version > 0 && g_capsuleOtaInstalled[i].version != version) continue;
    return i;
  }
  return -1;
}

static void capsuleOtaRecomputeUnseenCount() {
  uint32_t unseen = 0;
  for (int i = 0; i < g_capsuleOtaInstalledCount; i++) {
    if (!g_capsuleOtaInstalled[i].seen) unseen++;
  }
  g_capsuleOtaUnseenCount = unseen;
}

static bool capsuleOtaEnsureDir(const String& path) {
  if (path.length() == 0 || path == "/") return true;
  if (SD.exists(path)) return true;
  return SD.mkdir(path);
}

static bool capsuleOtaEnsureParentDir(const String& path) {
  int slash = path.lastIndexOf('/');
  if (slash <= 0) return true;
  return capsuleOtaEnsureDir(path.substring(0, slash));
}

static String capsuleOtaTempPathForInstallPath(const String& installPath) {
  int slash = installPath.lastIndexOf('/');
  String dir = slash >= 0 ? installPath.substring(0, slash) : "";
  String base = slash >= 0 ? installPath.substring(slash + 1) : installPath;
  return dir + "/." + base + ".part";
}

static bool capsuleOtaSaveIndex() {
  if (!g_sdMounted) return false;
  if (!capsuleOtaEnsureDir("/capsules")) return false;
  const String partPath = String(CAPSULE_OTA_INDEX_PATH) + ".part";
  if (SD.exists(partPath)) SD.remove(partPath);

  File f = SD.open(partPath, FILE_WRITE);
  if (!f) return false;
  f.print("[");
  for (int i = 0; i < g_capsuleOtaInstalledCount; i++) {
    if (i > 0) f.print(",");
    f.print("{\"capsuleId\":\""); f.print(ingestEscJson(g_capsuleOtaInstalled[i].capsuleId));
    f.print("\",\"version\":"); f.print(String(g_capsuleOtaInstalled[i].version));
    f.print(",\"deliveryId\":\""); f.print(ingestEscJson(g_capsuleOtaInstalled[i].deliveryId));
    f.print("\",\"title\":\""); f.print(ingestEscJson(g_capsuleOtaInstalled[i].title));
    f.print("\",\"type\":\""); f.print(ingestEscJson(g_capsuleOtaInstalled[i].type));
    f.print("\",\"desc\":\""); f.print(ingestEscJson(g_capsuleOtaInstalled[i].desc));
    f.print("\",\"installedPath\":\""); f.print(ingestEscJson(g_capsuleOtaInstalled[i].installedPath));
    f.print("\",\"sha256\":\""); f.print(ingestEscJson(g_capsuleOtaInstalled[i].sha256));
    f.print("\",\"sizeBytes\":"); f.print(String((unsigned long)g_capsuleOtaInstalled[i].sizeBytes));
    f.print(",\"seen\":"); f.print(g_capsuleOtaInstalled[i].seen ? "true" : "false");
    f.print("}");
  }
  f.print("]");
  f.close();

  if (SD.exists(CAPSULE_OTA_INDEX_PATH)) SD.remove(CAPSULE_OTA_INDEX_PATH);
  if (!SD.rename(partPath, CAPSULE_OTA_INDEX_PATH)) {
    if (SD.exists(partPath)) SD.remove(partPath);
    return false;
  }

  capsuleOtaRecomputeUnseenCount();
  return true;
}

static String capsuleOtaInstalledCapsulesJson() {
  String out = "[";
  for (int i = 0; i < g_capsuleOtaInstalledCount; i++) {
    if (i > 0) out += ",";
    out += "{\"capsuleId\":\"" + ingestEscJson(g_capsuleOtaInstalled[i].capsuleId) + "\",";
    out += "\"version\":" + String(g_capsuleOtaInstalled[i].version) + ",";
    out += "\"seen\":" + String(g_capsuleOtaInstalled[i].seen ? "true" : "false") + "}";
  }
  out += "]";
  return out;
}

void capsuleOtaLoadIndex() {
  g_capsuleOtaInstalledCount = 0;
  g_capsuleOtaLastInstalledAtMs = 0;
  g_capsuleOtaUnseenCount = 0;
  if (!g_sdMounted || !SD.exists(CAPSULE_OTA_INDEX_PATH)) return;

  File f = SD.open(CAPSULE_OTA_INDEX_PATH, FILE_READ);
  if (!f) return;
  String raw = f.readString();
  f.close();

  int pos = 0;
  while (g_capsuleOtaInstalledCount < 24) {
    int start = raw.indexOf("{", pos);
    if (start < 0) break;
    int end = raw.indexOf("}", start);
    if (end < 0) break;
    String obj = raw.substring(start, end + 1);
    OtaInstalledCapsule entry;
    entry.capsuleId = ingestJsonVal(obj, "capsuleId");
    entry.version = (int)ingestJsonVal(obj, "version").toInt();
    if (entry.version < 1) entry.version = 1;
    entry.deliveryId = ingestJsonVal(obj, "deliveryId");
    entry.title = ingestJsonVal(obj, "title");
    entry.type = ingestJsonVal(obj, "type");
    entry.desc = ingestJsonVal(obj, "desc");
    entry.installedPath = ingestJsonVal(obj, "installedPath");
    entry.sha256 = ingestJsonVal(obj, "sha256");
    long parsedSize = ingestJsonVal(obj, "sizeBytes").toInt();
    if (parsedSize < 0) parsedSize = 0;
    entry.sizeBytes = (uint32_t)parsedSize;
    entry.seen = ingestJsonVal(obj, "seen") == "true" || ingestJsonVal(obj, "seen") == "1";
    if (entry.capsuleId.length() > 0) {
      g_capsuleOtaInstalled[g_capsuleOtaInstalledCount++] = entry;
      g_capsuleOtaLastInstalledAtMs = millis();
    }
    pos = end + 1;
  }

  capsuleOtaRecomputeUnseenCount();
}

void capsuleOtaCleanupStaleParts() {
  if (!g_sdMounted || !SD.exists("/capsules")) return;
  File dir = SD.open("/capsules");
  if (!dir || !dir.isDirectory()) {
    if (dir) dir.close();
    return;
  }
  while (true) {
    File f = dir.openNextFile();
    if (!f) break;
    String name = String(f.name());
    bool isPart = name.endsWith(".part");
    f.close();
    if (isPart) {
      SD.remove(name);
      Serial.printf("[CAPSULE] Removed stale part file: %s\n", name.c_str());
    }
  }
  dir.close();
}

static String capsuleOtaCurrentDateString() {
  return String((unsigned long)(millis() / 1000UL));
}

static void capsuleOtaNotifyInstalled(const String& capsuleType) {
  if (capsuleType == "concert") ledNotify(g_dcnpConcert, "flash_burst", 1800UL);
  else if (capsuleType == "video") ledNotify(g_dcnpVideo, "fade_glow", 2200UL);
  else if (capsuleType == "merch") ledNotify(g_dcnpMerch, "flash_hold", 1800UL);
  else if (capsuleType == "signing") ledNotify(g_dcnpSigning, "breathing", 1600UL);
  else if (capsuleType == "remix") ledNotify(g_dcnpRemix, "rhythmic_pulse", 2000UL);
  else ledNotify(g_dcnpOther, "pulse", 1400UL);
}

static String ingestExtractFirstArrayObject(const String& body, const String& key) {
  String needle = "\"" + key + "\"";
  int idx = body.indexOf(needle);
  if (idx < 0) return "";
  int bracketStart = body.indexOf('[', idx + needle.length());
  if (bracketStart < 0) return "";
  int objStart = body.indexOf('{', bracketStart + 1);
  if (objStart < 0) return "";

  int depth = 0;
  bool inString = false;
  for (int i = objStart; i < (int)body.length(); i++) {
    char c = body.charAt(i);
    char prev = i > objStart ? body.charAt(i - 1) : '\0';
    if (c == '"' && prev != '\\') inString = !inString;
    if (inString) continue;
    if (c == '{') depth++;
    else if (c == '}') {
      depth--;
      if (depth == 0) {
        return body.substring(objStart, i + 1);
      }
    }
  }
  return "";
}

static String capsuleOtaCheckInBody() {
  String body = "{\"deviceId\":\"" + ingestEscJson(g_duid) + "\",";
  body += "\"firmwareVersion\":\"" + ingestEscJson(g_fwVersion) + "\",";
  body += "\"albumIds\":" + capsuleOtaAlbumIdsJson() + ",";
  body += "\"installedCapsules\":" + capsuleOtaInstalledCapsulesJson() + ",";
  body += "\"freeStorageMb\":" + String((int)(g_sdMounted ? g_sdFreeMB : 0)) + ",";
  body += "\"batteryPercent\":" + String(g_battPercent) + ",";
  body += "\"wifiRssi\":" + String(g_staRSSI) + "}";
  return body;
}

static void capsuleOtaApplyPendingResponse(const String& responseBody) {
  const int pendingCount = ingestJsonVal(responseBody, "pendingCount").toInt();
  g_capsuleOtaPendingCount = pendingCount > 0 ? (uint32_t)pendingCount : 0;
  if (g_capsuleOtaPendingCount == 0) {
    capsuleOtaResetPending();
    capsuleOtaApplyState("idle");
    return;
  }

  const String capsule = ingestExtractFirstArrayObject(responseBody, "capsules");
  if (capsule.length() == 0) {
    capsuleOtaResetPending();
    capsuleOtaApplyState("idle");
    return;
  }

  g_capsuleOtaPendingDeliveryId = ingestJsonVal(capsule, "deliveryId");
  g_capsuleOtaPendingCapsuleId = ingestJsonVal(capsule, "capsuleId");
  g_capsuleOtaPendingTitle = ingestJsonVal(capsule, "title");
  g_capsuleOtaPendingDesc = ingestJsonVal(capsule, "description");
  g_capsuleOtaPendingType = ingestJsonVal(capsule, "type");
  g_capsuleOtaPendingInstallPath = ingestJsonVal(capsule, "installPath");
  g_capsuleOtaPendingDownloadUrl = ingestJsonVal(capsule, "downloadUrl");
  g_capsuleOtaPendingLedIntent = ingestJsonVal(capsule, "ledIntent");
  g_capsuleOtaPendingSha256 = ingestJsonVal(capsule, "payloadSha256");
  long pendingSize = ingestJsonVal(capsule, "payloadSizeBytes").toInt();
  if (pendingSize < 0) pendingSize = 0;
  g_capsuleOtaPendingSizeBytes = (uint32_t)pendingSize;
  g_capsuleOtaPendingVersion = (int)ingestJsonVal(capsule, "version").toInt();
  if (g_capsuleOtaPendingVersion < 1) g_capsuleOtaPendingVersion = 1;
  capsuleOtaApplyState("pending");
}

static bool capsuleOtaCheckInNow() {
  if (!capsuleOtaIsConfigured()) {
    capsuleOtaResetPending();
    capsuleOtaApplyState("disabled");
    return false;
  }
  if (!g_staConnected) {
    capsuleOtaApplyState("waiting_sta");
    return false;
  }

  capsuleOtaApplyState("checking");
  String responseBody = "";
  int statusCode = ingestSendJsonRequest(
    "POST",
    ingestTrimmedBaseUrl() + "/internal-api/device/check-in",
    capsuleOtaCheckInBody(),
    "application/json",
    "X-DPA-Device-Token",
    g_ingestDeviceToken,
    responseBody
  );

  g_capsuleOtaLastPollAt = millis();
  if (statusCode < 200 || statusCode >= 300) {
    if (statusCode == 403) capsuleOtaApplyState("error", "device_token_rejected");
    else if (statusCode == 409) capsuleOtaApplyState("error", "device_not_registered");
    else capsuleOtaApplyState("error", "checkin_failed");
    capsuleOtaScheduleNextPoll(CAPSULE_OTA_POLL_ERROR_MS);
    return false;
  }

  capsuleOtaApplyPendingResponse(responseBody);
  capsuleOtaScheduleNextPoll(g_capsuleOtaPendingCount > 0 ? CAPSULE_OTA_POLL_PENDING_MS : CAPSULE_OTA_POLL_IDLE_MS);
  return true;
}

void capsuleOtaTick() {
  if (!capsuleOtaIsConfigured()) {
    if (g_capsuleOtaState != "disabled") {
      capsuleOtaResetPending();
      capsuleOtaApplyState("disabled");
    }
    return;
  }

  if (!g_staConnected) {
    if (g_capsuleOtaState != "waiting_sta") {
      capsuleOtaApplyState("waiting_sta");
    }
    return;
  }

  if (g_capsuleOtaState == "installed") {
    capsuleOtaResetPending();
    capsuleOtaApplyState("idle");
  }

  if (g_capsuleOtaState == "error") {
    if (g_capsuleOtaNextPollAt != 0 && millis() < g_capsuleOtaNextPollAt) return;
    capsuleOtaResetPending();
    capsuleOtaApplyState("idle");
  }

  if ((g_capsuleOtaState == "pending" || g_capsuleOtaState == "announced") && g_capsuleOtaPendingDeliveryId.length() > 0) {
    capsuleOtaProcessPendingDelivery();
    return;
  }

  if (g_capsuleOtaNextPollAt != 0 && millis() < g_capsuleOtaNextPollAt) return;
  if (capsuleOtaCheckInNow() && g_capsuleOtaPendingDeliveryId.length() > 0) {
    capsuleOtaProcessPendingDelivery();
  }
}

static bool ingestParseHttpUrl(const String& url, String& host, uint16_t& port, String& path) {
  if (!url.startsWith("http://")) return false;
  String rest = url.substring(7);
  int slash = rest.indexOf('/');
  String hostPort = slash >= 0 ? rest.substring(0, slash) : rest;
  path = slash >= 0 ? rest.substring(slash) : "/";
  int colon = hostPort.indexOf(':');
  if (colon >= 0) {
    host = hostPort.substring(0, colon);
    port = (uint16_t)hostPort.substring(colon + 1).toInt();
  } else {
    host = hostPort;
    port = 80;
  }
  if (host.length() == 0 || path.length() == 0) return false;
  return true;
}

static int ingestReadHttpResponse(WiFiClient& client, String& body, unsigned long timeoutMs = 15000) {
  unsigned long deadline = millis() + timeoutMs;
  while (!client.available() && client.connected() && millis() < deadline) {
    delay(5);
  }
  if (!client.available()) {
    client.stop();
    body = "";
    return -1;
  }

  String statusLine = client.readStringUntil('\n');
  statusLine.trim();
  int statusCode = 0;
  int firstSpace = statusLine.indexOf(' ');
  if (firstSpace >= 0 && statusLine.length() >= firstSpace + 4) {
    statusCode = statusLine.substring(firstSpace + 1, firstSpace + 4).toInt();
  }

  int contentLength = -1;
  while (millis() < deadline) {
    String line = client.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) break;
    if (line.startsWith("Content-Length:")) {
      contentLength = line.substring(15).toInt();
    }
  }

  body = "";
  if (contentLength >= 0) {
    while ((int)body.length() < contentLength && millis() < deadline) {
      while (client.available() && (int)body.length() < contentLength) {
        body += (char)client.read();
      }
      if ((int)body.length() >= contentLength) break;
      delay(2);
    }
  } else {
    while ((client.connected() || client.available()) && millis() < deadline) {
      while (client.available()) {
        body += (char)client.read();
      }
      if (!client.connected()) break;
      delay(2);
    }
  }

  client.stop();
  return statusCode;
}

static int ingestSendJsonRequest(
  const String& method,
  const String& url,
  const String& body,
  const String& contentType,
  const String& authHeaderName,
  const String& authHeaderValue,
  String& responseBody
) {
  String host, path;
  uint16_t port = 80;
  if (!ingestParseHttpUrl(url, host, port, path)) return -1;

  WiFiClient client;
  client.setTimeout(15000);
  if (!client.connect(host.c_str(), port)) {
    responseBody = "";
    return -1;
  }

  client.print(method + " " + path + " HTTP/1.1\r\n");
  client.print("Host: " + host + "\r\n");
  client.print("Connection: close\r\n");
  client.print("Content-Type: " + contentType + "\r\n");
  client.print("Content-Length: " + String(body.length()) + "\r\n");
  if (authHeaderName.length() > 0 && authHeaderValue.length() > 0) {
    client.print(authHeaderName + ": " + authHeaderValue + "\r\n");
  }
  client.print("\r\n");
  client.print(body);
  return ingestReadHttpResponse(client, responseBody);
}

static int ingestSendFilePut(
  const String& url,
  const String& mimeType,
  const String& authHeaderValue,
  File& file,
  size_t fileSize,
  String& responseBody
) {
  String host, path;
  uint16_t port = 80;
  if (!ingestParseHttpUrl(url, host, port, path)) return -1;

  WiFiClient client;
  client.setTimeout(30000);
  if (!client.connect(host.c_str(), port)) {
    responseBody = "";
    return -1;
  }

  client.print("PUT " + path + " HTTP/1.1\r\n");
  client.print("Host: " + host + "\r\n");
  client.print("Connection: close\r\n");
  client.print("Content-Type: " + mimeType + "\r\n");
  client.print("Content-Length: " + String((unsigned long)fileSize) + "\r\n");
  if (authHeaderValue.length() > 0) {
    client.print("X-DPA-Upload-Token: " + authHeaderValue + "\r\n");
  }
  client.print("\r\n");

  uint8_t buf[1024];
  while (file.available()) {
    size_t readLen = file.read(buf, sizeof(buf));
    if (readLen == 0) break;
    client.write(buf, readLen);
  }
  client.flush();

  return ingestReadHttpResponse(client, responseBody, 30000);
}

static int capsuleOtaPostDeliveryAction(const String& action, const String& body, String& responseBody) {
  if (!capsuleOtaIsConfigured() || g_capsuleOtaPendingDeliveryId.length() == 0) return -1;
  const String url = ingestTrimmedBaseUrl()
    + "/internal-api/device/capsules/" + ingestUrlEncode(g_capsuleOtaPendingDeliveryId)
    + "/" + action;
  return ingestSendJsonRequest(
    "POST",
    url,
    body,
    "application/json",
    "X-DPA-Device-Token",
    g_ingestDeviceToken,
    responseBody
  );
}

static bool capsuleOtaReportProgress(const String& status, uint32_t progressBytes, uint32_t totalBytes) {
  String responseBody = "";
  String body = "{\"deviceId\":\"" + ingestEscJson(g_duid) + "\",";
  body += "\"capsuleId\":\"" + ingestEscJson(g_capsuleOtaPendingCapsuleId) + "\",";
  body += "\"status\":\"" + ingestEscJson(status) + "\",";
  body += "\"progressBytes\":" + String((unsigned long)progressBytes) + ",";
  body += "\"totalBytes\":" + String((unsigned long)totalBytes) + "}";
  int code = capsuleOtaPostDeliveryAction("progress", body, responseBody);
  return code >= 200 && code < 300;
}

static bool capsuleOtaReportFailure(const String& error) {
  if (g_capsuleOtaPendingDeliveryId.length() == 0) return false;
  String responseBody = "";
  String body = "{\"deviceId\":\"" + ingestEscJson(g_duid) + "\",";
  body += "\"capsuleId\":\"" + ingestEscJson(g_capsuleOtaPendingCapsuleId) + "\",";
  body += "\"status\":\"failed\",";
  body += "\"error\":\"" + ingestEscJson(error) + "\"}";
  int code = capsuleOtaPostDeliveryAction("fail", body, responseBody);
  return code >= 200 && code < 300;
}

static bool capsuleOtaAnnouncePending() {
  if (g_capsuleOtaPendingDeliveryId.length() == 0) return false;
  String responseBody = "";
  String body = "{\"deviceId\":\"" + ingestEscJson(g_duid) + "\",";
  body += "\"capsuleId\":\"" + ingestEscJson(g_capsuleOtaPendingCapsuleId) + "\"}";
  int code = capsuleOtaPostDeliveryAction("announce", body, responseBody);
  if (code < 200 || code >= 300) return false;
  capsuleOtaApplyState("announced");
  return true;
}

static bool capsuleOtaReportDownloaded(const String& tempPath, const String& sha256Hex, uint32_t sizeBytes) {
  String responseBody = "";
  String body = "{\"deviceId\":\"" + ingestEscJson(g_duid) + "\",";
  body += "\"capsuleId\":\"" + ingestEscJson(g_capsuleOtaPendingCapsuleId) + "\",";
  body += "\"sha256\":\"" + ingestEscJson(sha256Hex) + "\",";
  body += "\"sizeBytes\":" + String((unsigned long)sizeBytes) + ",";
  body += "\"tempPath\":\"" + ingestEscJson(tempPath) + "\"}";
  int code = capsuleOtaPostDeliveryAction("downloaded", body, responseBody);
  return code >= 200 && code < 300;
}

static bool capsuleOtaReportComplete(const String& installedPath, const String& sha256Hex, uint32_t sizeBytes) {
  String responseBody = "";
  String body = "{\"deviceId\":\"" + ingestEscJson(g_duid) + "\",";
  body += "\"capsuleId\":\"" + ingestEscJson(g_capsuleOtaPendingCapsuleId) + "\",";
  body += "\"installedPath\":\"" + ingestEscJson(installedPath) + "\",";
  body += "\"sha256\":\"" + ingestEscJson(sha256Hex) + "\",";
  body += "\"sizeBytes\":" + String((unsigned long)sizeBytes) + "}";
  int code = capsuleOtaPostDeliveryAction("complete", body, responseBody);
  return code >= 200 && code < 300;
}

static bool capsuleOtaDownloadToFile(
  const String& originalUrl,
  const String& tempPath,
  String& sha256Hex,
  uint32_t& sizeBytes,
  String& errorOut
) {
  String url = originalUrl;
  for (int redirectCount = 0; redirectCount < 2; redirectCount++) {
    String host, path;
    uint16_t port = 80;
    if (!ingestParseHttpUrl(url, host, port, path)) {
      errorOut = "unsupported_payload";
      return false;
    }

    WiFiClient client;
    client.setTimeout(30000);
    if (!client.connect(host.c_str(), port)) {
      errorOut = "download_failed";
      return false;
    }

    client.print("GET " + path + " HTTP/1.1\r\n");
    client.print("Host: " + host + "\r\n");
    client.print("Connection: close\r\n");
    client.print("X-DPA-Device-Token: " + g_ingestDeviceToken + "\r\n");
    client.print("\r\n");

    const unsigned long headerDeadline = millis() + 15000UL;
    while (!client.available() && client.connected() && millis() < headerDeadline) {
      delay(5);
    }
    if (!client.available()) {
      client.stop();
      errorOut = "download_failed";
      return false;
    }

    String statusLine = client.readStringUntil('\n');
    statusLine.trim();
    int statusCode = 0;
    int firstSpace = statusLine.indexOf(' ');
    if (firstSpace >= 0 && statusLine.length() >= firstSpace + 4) {
      statusCode = statusLine.substring(firstSpace + 1, firstSpace + 4).toInt();
    }

    int contentLength = -1;
    String redirectLocation = "";
    while (millis() < headerDeadline) {
      String line = client.readStringUntil('\n');
      line.trim();
      if (line.length() == 0) break;
      if (line.startsWith("Content-Length:")) {
        contentLength = line.substring(15).toInt();
      } else if (line.startsWith("Location:")) {
        redirectLocation = line.substring(9);
        redirectLocation.trim();
      }
    }

    if ((statusCode == 301 || statusCode == 302) && redirectLocation.length() > 0) {
      client.stop();
      url = redirectLocation;
      continue;
    }
    if (statusCode < 200 || statusCode >= 300) {
      client.stop();
      errorOut = "download_failed";
      return false;
    }
    if (!capsuleOtaEnsureParentDir(tempPath)) {
      client.stop();
      errorOut = "storage_insufficient";
      return false;
    }
    if (SD.exists(tempPath)) SD.remove(tempPath);

    File file = SD.open(tempPath, FILE_WRITE);
    if (!file) {
      client.stop();
      errorOut = "storage_insufficient";
      return false;
    }

    mbedtls_sha256_context shaCtx;
    mbedtls_sha256_init(&shaCtx);
    mbedtls_sha256_starts(&shaCtx, 0);

    uint8_t buf[1024];
    sizeBytes = 0;
    uint32_t nextProgressAt = CAPSULE_OTA_PROGRESS_STEP_BYTES;
    const uint32_t totalBytes = contentLength > 0 ? (uint32_t)contentLength : g_capsuleOtaPendingSizeBytes;
    unsigned long readDeadline = millis() + 30000UL;
    while ((client.connected() || client.available()) && millis() < readDeadline) {
      while (client.available()) {
        int readLen = client.read(buf, sizeof(buf));
        if (readLen <= 0) break;
        if (file.write(buf, (size_t)readLen) != (size_t)readLen) {
          file.close();
          client.stop();
          mbedtls_sha256_free(&shaCtx);
          errorOut = "storage_insufficient";
          return false;
        }
        mbedtls_sha256_update(&shaCtx, buf, (size_t)readLen);
        sizeBytes += (uint32_t)readLen;
        readDeadline = millis() + 30000UL;
        if (sizeBytes >= nextProgressAt) {
          capsuleOtaReportProgress("downloading", sizeBytes, totalBytes);
          nextProgressAt += CAPSULE_OTA_PROGRESS_STEP_BYTES;
        }
      }
      if (!client.connected() && !client.available()) break;
      delay(2);
    }

    file.close();
    client.stop();

    unsigned char hash[32];
    mbedtls_sha256_finish(&shaCtx, hash);
    mbedtls_sha256_free(&shaCtx);

    char hex[65];
    for (int i = 0; i < 32; i++) sprintf(hex + (i * 2), "%02x", hash[i]);
    hex[64] = 0;
    sha256Hex = String(hex);

    if (g_capsuleOtaPendingSizeBytes > 0 && sizeBytes != g_capsuleOtaPendingSizeBytes) {
      errorOut = "checksum_mismatch";
      return false;
    }
    if (g_capsuleOtaPendingSha256.length() > 0 && !g_capsuleOtaPendingSha256.equalsIgnoreCase(sha256Hex)) {
      errorOut = "checksum_mismatch";
      return false;
    }

    capsuleOtaReportProgress("downloading", sizeBytes, totalBytes);
    return true;
  }

  errorOut = "download_failed";
  return false;
}

static bool capsuleOtaUpsertInstalledRecord(const String& installedPath, const String& sha256Hex, uint32_t sizeBytes) {
  OtaInstalledCapsule entry;
  entry.capsuleId = g_capsuleOtaPendingCapsuleId;
  entry.version = g_capsuleOtaPendingVersion;
  entry.deliveryId = g_capsuleOtaPendingDeliveryId;
  entry.title = g_capsuleOtaPendingTitle;
  entry.type = g_capsuleOtaPendingType;
  entry.desc = g_capsuleOtaPendingDesc;
  entry.installedPath = installedPath;
  entry.sha256 = sha256Hex;
  entry.sizeBytes = sizeBytes;
  entry.seen = false;

  int idx = capsuleOtaFindInstalledIndex(entry.capsuleId, entry.version);
  if (idx >= 0) g_capsuleOtaInstalled[idx] = entry;
  else if (g_capsuleOtaInstalledCount < 24) g_capsuleOtaInstalled[g_capsuleOtaInstalledCount++] = entry;
  else {
    for (int i = 0; i < 23; i++) g_capsuleOtaInstalled[i] = g_capsuleOtaInstalled[i + 1];
    g_capsuleOtaInstalled[23] = entry;
  }

  if (!capsuleOtaSaveIndex()) return false;
  g_capsuleOtaLastInstalledAtMs = millis();
  upsertRuntimeCapsuleRecord(
    entry.capsuleId,
    entry.type,
    entry.title,
    entry.desc,
    capsuleOtaCurrentDateString(),
    true,
    entry.version,
    false,
    0.0f,
    "",
    "",
    false,
    entry.installedPath,
    entry.deliveryId,
    "ota"
  );
  capsuleOtaRecomputeUnseenCount();
  return true;
}

static void capsuleOtaTransitionToIdleSoon() {
  capsuleOtaScheduleNextPoll(CAPSULE_OTA_POLL_ACTIVE_MS);
}

static void capsuleOtaHandleFailure(const String& error) {
  capsuleOtaApplyState("error", error);
  capsuleOtaReportFailure(error);
  capsuleOtaTransitionToIdleSoon();
}

static void capsuleOtaProcessPendingDelivery() {
  if (!g_sdMounted) {
    capsuleOtaHandleFailure("storage_insufficient");
    return;
  }
  if (!g_staConnected) {
    capsuleOtaHandleFailure("sta_not_connected");
    return;
  }
  if (g_capsuleOtaPendingDeliveryId.length() == 0 || g_capsuleOtaPendingInstallPath.length() == 0 || g_capsuleOtaPendingDownloadUrl.length() == 0) {
    capsuleOtaHandleFailure("download_failed");
    return;
  }

  sdRefreshStats();
  if (g_capsuleOtaPendingSizeBytes > 0) {
    const float requiredMb = ((float)g_capsuleOtaPendingSizeBytes / (1024.0f * 1024.0f)) + 2.0f;
    if (g_sdFreeMB > 0 && g_sdFreeMB < requiredMb) {
      capsuleOtaHandleFailure("storage_insufficient");
      return;
    }
  }

  if (g_capsuleOtaState == "pending" && !capsuleOtaAnnouncePending()) {
    capsuleOtaHandleFailure("download_failed");
    return;
  }

  capsuleOtaApplyState("downloading");
  sdMountSlow();

  const String tempPath = capsuleOtaTempPathForInstallPath(g_capsuleOtaPendingInstallPath);
  String sha256Hex = "";
  uint32_t sizeBytes = 0;
  String error = "";
  if (!capsuleOtaDownloadToFile(g_capsuleOtaPendingDownloadUrl, tempPath, sha256Hex, sizeBytes, error)) {
    if (SD.exists(tempPath)) SD.remove(tempPath);
    capsuleOtaHandleFailure(error.length() ? error : "download_failed");
    sdMountFast();
    sdRefreshStats();
    return;
  }

  capsuleOtaApplyState("verifying");
  if (!capsuleOtaReportDownloaded(tempPath, sha256Hex, sizeBytes)) {
    if (SD.exists(tempPath)) SD.remove(tempPath);
    capsuleOtaHandleFailure("checksum_mismatch");
    sdMountFast();
    sdRefreshStats();
    return;
  }

  capsuleOtaApplyState("installing");
  if (SD.exists(g_capsuleOtaPendingInstallPath)) SD.remove(g_capsuleOtaPendingInstallPath);
  if (!SD.rename(tempPath, g_capsuleOtaPendingInstallPath)) {
    if (SD.exists(tempPath)) SD.remove(tempPath);
    capsuleOtaHandleFailure("rename_failed");
    sdMountFast();
    sdRefreshStats();
    return;
  }

  if (!capsuleOtaUpsertInstalledRecord(g_capsuleOtaPendingInstallPath, sha256Hex, sizeBytes)) {
    capsuleOtaHandleFailure("install_index_failed");
    sdMountFast();
    sdRefreshStats();
    return;
  }

  capsuleOtaReportComplete(g_capsuleOtaPendingInstallPath, sha256Hex, sizeBytes);
  capsuleOtaNotifyInstalled(g_capsuleOtaPendingType);
  capsuleOtaApplyState("installed");
  capsuleOtaTransitionToIdleSoon();
  sdMountFast();
  sdRefreshStats();
}

bool capsuleOtaAckSeen(const String& capsuleId) {
  int idx = capsuleOtaFindInstalledIndex(capsuleId);
  if (idx < 0) return false;

  if (!g_capsuleOtaInstalled[idx].seen) {
    g_capsuleOtaInstalled[idx].seen = true;
    capsuleOtaSaveIndex();
    markRuntimeCapsuleSeenAndSave(capsuleId);
    capsuleOtaRecomputeUnseenCount();
  }

  if (!capsuleOtaIsConfigured() || g_capsuleOtaInstalled[idx].deliveryId.length() == 0) return false;
  String responseBody = "";
  String url = ingestTrimmedBaseUrl()
    + "/internal-api/device/capsules/" + ingestUrlEncode(g_capsuleOtaInstalled[idx].deliveryId)
    + "/seen";
  String body = "{\"deviceId\":\"" + ingestEscJson(g_duid) + "\",";
  body += "\"capsuleId\":\"" + ingestEscJson(capsuleId) + "\"}";
  int code = ingestSendJsonRequest(
    "POST",
    url,
    body,
    "application/json",
    "X-DPA-Device-Token",
    g_ingestDeviceToken,
    responseBody
  );
  return code >= 200 && code < 300;
}

void ingestLoadFromNVS() {
  Preferences prefs;
  prefs.begin("dpa_ingest", true);
  g_ingestBaseUrl = prefs.getString("base", "");
  g_ingestDeviceToken = prefs.getString("token", "");
  prefs.end();

  if (g_ingestBaseUrl.length() > 0 && g_ingestDeviceToken.length() > 0) {
    ingestApplyState("idle");
    capsuleOtaApplyState("idle");
  } else {
    ingestApplyState("disabled");
    capsuleOtaResetPending();
    capsuleOtaApplyState("disabled");
  }
}

void ingestSaveToNVS() {
  Preferences prefs;
  prefs.begin("dpa_ingest", false);
  prefs.putString("base", g_ingestBaseUrl);
  prefs.putString("token", g_ingestDeviceToken);
  prefs.end();
}

void ingestSetConfig(const String& baseUrl, const String& deviceToken) {
  g_ingestBaseUrl = baseUrl;
  g_ingestDeviceToken = deviceToken;
  ingestSaveToNVS();
  if (g_ingestBaseUrl.length() > 0 && g_ingestDeviceToken.length() > 0) {
    ingestApplyState("idle");
    capsuleOtaApplyState("idle");
    g_capsuleOtaNextPollAt = 0;
  } else {
    ingestApplyState("disabled");
    capsuleOtaResetPending();
    capsuleOtaApplyState("disabled");
  }
}

void ingestClearConfig() {
  g_ingestBaseUrl = "";
  g_ingestDeviceToken = "";
  g_ingestLastSessionId = "";
  g_ingestLastAlbumId = "";
  g_ingestLastFile = "";
  ingestSaveToNVS();
  ingestApplyState("disabled");
  capsuleOtaResetPending();
  capsuleOtaApplyState("disabled");
  g_capsuleOtaNextPollAt = 0;
}

bool ingestIsConfigured() {
  return ingestTrimmedBaseUrl().length() > 0 && g_ingestDeviceToken.length() > 0;
}

bool ingestPushFile(const String& sdPath, const String& albumId, const String& contentKind = "support") {
  g_ingestLastFile = sdPath;
  g_ingestLastAlbumId = albumId;
  g_ingestLastSessionId = "";

  if (!ingestIsConfigured()) {
    ingestApplyState("error", "not_configured");
    return false;
  }
  if (!g_staConnected) {
    ingestApplyState("error", "sta_not_connected");
    return false;
  }
  if (!SD.exists(sdPath)) {
    ingestApplyState("error", "file_missing");
    return false;
  }

  String baseUrl = ingestTrimmedBaseUrl();
  String fileName = sdPath.substring(sdPath.lastIndexOf('/') + 1);
  String mimeType = "application/octet-stream";
  String lower = fileName;
  lower.toLowerCase();
  if (lower.endsWith(".json")) mimeType = "application/json";
  else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) mimeType = "image/jpeg";
  else if (lower.endsWith(".png")) mimeType = "image/png";
  else if (lower.endsWith(".wav")) mimeType = "audio/wav";
  else if (lower.endsWith(".dpa")) mimeType = "application/octet-stream";

  ingestApplyState("preparing");

  String sessionBody = "{\"deviceId\":\"" + g_duid + "\",";
  sessionBody += "\"albumId\":\"" + albumId + "\",";
  sessionBody += "\"filename\":\"" + fileName + "\",";
  sessionBody += "\"mimeType\":\"" + mimeType + "\",";
  sessionBody += "\"contentKind\":\"" + contentKind + "\"}";

  String sessionResponse = "";
  int sessionCode = ingestSendJsonRequest(
    "POST",
    baseUrl + "/internal-api/device/session",
    sessionBody,
    "application/json",
    "X-DPA-Device-Token",
    g_ingestDeviceToken,
    sessionResponse
  );

  if (sessionCode < 200 || sessionCode >= 300) {
    ingestApplyState("error", "session_rejected");
    return false;
  }

  String sessionId = ingestJsonVal(sessionResponse, "sessionId");
  String uploadToken = ingestJsonVal(sessionResponse, "uploadToken");
  if (sessionId.length() == 0 || uploadToken.length() == 0) {
    ingestApplyState("error", "session_invalid");
    return false;
  }

  g_ingestLastSessionId = sessionId;

  File file = SD.open(sdPath, FILE_READ);
  if (!file) {
    ingestApplyState("error", "file_open_failed");
    return false;
  }

  ingestApplyState("uploading");

  String uploadUrl = baseUrl + "/internal-api/ingest/upload/" + sessionId
    + "?filename=" + ingestUrlEncode(fileName);
  String uploadResponse = "";
  int uploadCode = ingestSendFilePut(uploadUrl, mimeType, uploadToken, file, file.size(), uploadResponse);
  file.close();

  if (uploadCode < 200 || uploadCode >= 300) {
    ingestApplyState("error", "upload_failed");
    return false;
  }

  ingestApplyState("verifying");

  String completeResponse = "";
  int completeCode = ingestSendJsonRequest(
    "POST",
    baseUrl + "/internal-api/ingest/complete/" + sessionId,
    "{}",
    "application/json",
    "X-DPA-Upload-Token",
    uploadToken,
    completeResponse
  );

  if (completeCode < 200 || completeCode >= 300) {
    ingestApplyState("error", "verify_failed");
    return false;
  }

  String ok = ingestJsonVal(completeResponse, "ok");
  if (ok != "true" && ok != "1") {
    ingestApplyState("error", "verify_failed");
    return false;
  }

  ingestApplyState("complete");
  return true;
}

#endif // DPA_INGEST_H
