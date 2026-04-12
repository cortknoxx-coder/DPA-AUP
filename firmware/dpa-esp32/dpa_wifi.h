/*
 * DPA WiFi Manager — dpa_wifi.h
 * ESP-IDF native WiFi: dual AP+STA, event-driven, NVS persistence
 *
 * Uses esp_wifi / esp_netif / esp_event instead of Arduino WiFi.h
 * for better AP client retention, finer power control, and
 * event-driven STA management (no polling loops).
 *
 * Public API (unchanged from Arduino version):
 *   wifiInit(), wifiConnectSTA(), wifiDisconnectSTA(),
 *   wifiTick(), wifiDoScan(), wifiRequestScan(),
 *   wifiBuildSSID(), wifiSetMetadata(),
 *   wifiGetArtist(), wifiGetAlbum(), wifiGetApSSID()
 *
 * New accessors (replaces WiFi.softAPIP(), WiFi.setSleep(), etc.):
 *   wifiGetApIPStr(), wifiGetApStationCount(), wifiSetSleep()
 */

#ifndef DPA_WIFI_H
#define DPA_WIFI_H

#include <Arduino.h>      // String, Serial, millis, delay
#include <WiFi.h>         // Arduino WiFi class — used for mode() init only
#include <Preferences.h>  // NVS persistence (thin wrapper over esp_nvs)
#include <esp_wifi.h>
#include <esp_netif.h>
#include <esp_event.h>

// Default AP SSID fallback
#define DPA_AP_SSID_DEFAULT "DPA-Portal"

// Dynamic SSID built from artist-album metadata (max 32 chars)
static String g_apSSID = DPA_AP_SSID_DEFAULT;

// Cached artist/album metadata — populated by wifiBuildSSID() from NVS
static String g_metaArtist = "";
static String g_metaAlbum  = "";

// Stored AP credentials so we can re-raise the softAP when metadata changes.
static String g_apPassword  = "";
static int    g_apChannelRef = 6;
static int    g_apMaxConnRef = 4;

// Network interfaces (created once in wifiInit, never destroyed)
static esp_netif_t* g_apNetif  = nullptr;
static esp_netif_t* g_staNetif = nullptr;

// ── Extern Globals (defined in .ino) ─────────────────────────
extern String g_duid;
extern void noteDisconnectBreadcrumb(
  const String& kind,
  const String& scope,
  const String& cause,
  const String& detail,
  int reasonCode,
  int staRssiSnapshot,
  int apClientCountSnapshot,
  uint32_t freeHeapSnapshot,
  uint32_t largestHeapBlockSnapshot
);
extern bool g_apRecoveryPending;
extern unsigned long g_apRecoveryRequestedAtMs;

// ── WiFi STA State ──────────────────────────────────────────
String g_staSSID     = "";
String g_staPassword = "";
String g_staIP       = "";
bool   g_staConnected = false;
int    g_staRSSI     = 0;

// Queued from HTTP admin handler; processed in wifiTick() to avoid blocking AsyncWebServer.
bool g_staJoinPending = false;
bool g_staJoinQueued  = false;

// Event flags (set in ISR/event context, consumed in wifiTick on main loop)
static volatile bool g_staGotIP          = false;
static volatile bool g_staDisconnected   = false;
static volatile int  g_staDisconnectReason = 0;
static volatile bool g_apClientDisconnected = false;

// Scan results (held in memory after scan)
struct WifiNetwork {
  String ssid;
  int rssi;
  bool open;  // true if no encryption
};
static WifiNetwork g_scanResults[20];
static int  g_scanCount = 0;
static bool g_scanning  = false;

static bool g_scanRequested = false;  // API sets this, loop() acts on it
static volatile bool g_scanDone = false;

// Throttle RSSI polling
static uint32_t g_lastRssiPollMs = 0;

static String wifiStaDisconnectReasonLabel(int reason) {
  switch (reason) {
    case WIFI_REASON_BEACON_TIMEOUT: return "beacon_timeout";
    case WIFI_REASON_NO_AP_FOUND: return "no_ap_found";
    case WIFI_REASON_AUTH_FAIL: return "auth_fail";
    case WIFI_REASON_HANDSHAKE_TIMEOUT: return "handshake_timeout";
    case WIFI_REASON_CONNECTION_FAIL: return "connection_fail";
    case WIFI_REASON_ASSOC_FAIL: return "assoc_fail";
    case WIFI_REASON_ASSOC_LEAVE: return "assoc_leave";
    case WIFI_REASON_AUTH_EXPIRE: return "auth_expire";
    case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT: return "4way_timeout";
    case WIFI_REASON_ROAMING: return "roaming";
    default: return "reason_" + String(reason);
  }
}

// ── WiFi Event Handler (runs on system event task) ──────────
static void wifiEventHandler(void* arg, esp_event_base_t base,
                             int32_t id, void* data) {
  if (base == WIFI_EVENT) {
    switch (id) {
      case WIFI_EVENT_STA_DISCONNECTED: {
        wifi_event_sta_disconnected_t* ev =
          (wifi_event_sta_disconnected_t*)data;
        g_staDisconnected = true;
        g_staDisconnectReason = ev->reason;
        break;
      }
      case WIFI_EVENT_SCAN_DONE:
        g_scanDone = true;
        break;
      case WIFI_EVENT_AP_STACONNECTED: {
        wifi_event_ap_staconnected_t* ev =
          (wifi_event_ap_staconnected_t*)data;
        Serial.printf("[WIFI] AP client joined: " MACSTR "\n",
                      MAC2STR(ev->mac));
        break;
      }
      case WIFI_EVENT_AP_STADISCONNECTED: {
        wifi_event_ap_stadisconnected_t* ev =
          (wifi_event_ap_stadisconnected_t*)data;
        g_apClientDisconnected = true;
        Serial.printf("[WIFI] AP client left: " MACSTR "\n",
                      MAC2STR(ev->mac));
        break;
      }
      default:
        break;
    }
  } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
    g_staGotIP = true;
  }
}

// ── Accessors (replace Arduino WiFi.softAPIP() etc.) ─────────
String wifiGetApIPStr() {
  if (!g_apNetif) return "192.168.4.1";
  esp_netif_ip_info_t info;
  if (esp_netif_get_ip_info(g_apNetif, &info) == ESP_OK) {
    char buf[16];
    snprintf(buf, sizeof(buf), IPSTR, IP2STR(&info.ip));
    return String(buf);
  }
  return "192.168.4.1";
}

int wifiGetApStationCount() {
  wifi_sta_list_t list;
  if (esp_wifi_ap_get_sta_list(&list) == ESP_OK) {
    return list.num;
  }
  return 0;
}

void wifiSetSleep(bool enable) {
  esp_wifi_set_ps(enable ? WIFI_PS_MIN_MODEM : WIFI_PS_NONE);
}

// ── NVS Load/Save ────────────────────────────────────────────
void wifiLoadFromNVS() {
  Preferences prefs;
  prefs.begin("dpa_wifi", true);
  g_staSSID     = prefs.getString("ssid", "");
  g_staPassword = prefs.getString("pass", "");
  prefs.end();
  if (g_staSSID.length() > 0) {
    Serial.println("[WIFI] Stored STA credentials: " + g_staSSID);
  } else {
    Serial.println("[WIFI] No stored STA credentials");
  }
}

void wifiSaveToNVS() {
  Preferences prefs;
  prefs.begin("dpa_wifi", false);
  prefs.putString("ssid", g_staSSID);
  prefs.putString("pass", g_staPassword);
  prefs.end();
  Serial.println("[WIFI] STA credentials saved to NVS");
}

void wifiClearNVS() {
  Preferences prefs;
  prefs.begin("dpa_wifi", false);
  prefs.remove("ssid");
  prefs.remove("pass");
  prefs.end();
  g_staSSID = "";
  g_staPassword = "";
  Serial.println("[WIFI] STA credentials cleared");
}

// ── STA Connection ───────────────────────────────────────────
bool wifiConnectSTA() {
  if (g_staSSID.length() == 0) return false;

  Serial.println("[WIFI] Connecting STA to: " + g_staSSID);

  wifi_config_t sta_cfg = {};
  strncpy((char*)sta_cfg.sta.ssid, g_staSSID.c_str(),
          sizeof(sta_cfg.sta.ssid) - 1);
  strncpy((char*)sta_cfg.sta.password, g_staPassword.c_str(),
          sizeof(sta_cfg.sta.password) - 1);
  sta_cfg.sta.scan_method = WIFI_ALL_CHANNEL_SCAN;
  sta_cfg.sta.sort_method = WIFI_CONNECT_AP_BY_SIGNAL;
  esp_wifi_set_config(WIFI_IF_STA, &sta_cfg);

  g_staGotIP = false;
  esp_wifi_connect();

  // Wait up to 10 seconds for IP assignment
  int attempts = 0;
  while (!g_staGotIP && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  Serial.println();

  if (g_staGotIP) {
    g_staConnected = true;
    // Read IP from netif
    esp_netif_ip_info_t ip_info;
    esp_netif_get_ip_info(g_staNetif, &ip_info);
    char ip_buf[16];
    snprintf(ip_buf, sizeof(ip_buf), IPSTR, IP2STR(&ip_info.ip));
    g_staIP = String(ip_buf);
    // Read RSSI
    wifi_ap_record_t ap_info;
    if (esp_wifi_sta_get_ap_info(&ap_info) == ESP_OK) {
      g_staRSSI = ap_info.rssi;
    }
    Serial.println("[WIFI] STA connected!");
    Serial.println("[WIFI] STA IP: " + g_staIP);
    Serial.println("[WIFI] RSSI: " + String(g_staRSSI) + " dBm");
    return true;
  } else {
    g_staConnected = false;
    g_staIP = "";
    Serial.println("[WIFI] STA connection FAILED");
    return false;
  }
}

void wifiDisconnectSTA() {
  esp_wifi_disconnect();
  g_staConnected = false;
  g_staIP = "";
  g_staRSSI = 0;
  Serial.println("[WIFI] STA disconnected");
}

// ── WiFi Scan ────────────────────────────────────────────────

void wifiRequestScan() {
  if (!g_scanning) {
    g_scanRequested = true;
  }
}

// Called from loop() — starts async scan and collects results
void wifiDoScan() {
  // Collect completed scan results
  if (g_scanDone) {
    g_scanDone = false;
    uint16_t ap_count = 0;
    esp_wifi_scan_get_ap_num(&ap_count);

    if (ap_count > 0) {
      uint16_t max_records = ap_count > 20 ? 20 : ap_count;
      wifi_ap_record_t* records =
        (wifi_ap_record_t*)malloc(max_records * sizeof(wifi_ap_record_t));
      if (records) {
        esp_wifi_scan_get_ap_records(&max_records, records);
        g_scanCount = max_records;
        for (int i = 0; i < g_scanCount; i++) {
          g_scanResults[i].ssid = String((char*)records[i].ssid);
          g_scanResults[i].rssi = records[i].rssi;
          g_scanResults[i].open = (records[i].authmode == WIFI_AUTH_OPEN);
        }
        free(records);
        Serial.printf("[WIFI] Found %d networks\n", g_scanCount);
      }
    } else {
      g_scanCount = 0;
      Serial.println("[WIFI] Scan returned 0 networks");
    }
    g_scanning = false;
    return;
  }

  // Start new scan if requested
  if (!g_scanRequested || g_scanning) return;
  g_scanRequested = false;
  g_scanning = true;
  g_scanCount = 0;

  Serial.println("[WIFI] Starting network scan...");
  wifi_scan_config_t scan_cfg = {};
  scan_cfg.show_hidden = false;
  esp_wifi_scan_start(&scan_cfg, false);  // async, result via SCAN_DONE event
}

// ── Update STA status (call from loop) ───────────────────────
void wifiTick() {
  // Handle disconnect event (from event handler)
  if (g_staDisconnected) {
    g_staDisconnected = false;
    bool wasConnected = g_staConnected;
    g_staConnected = false;
    g_staIP = "";
    if (wasConnected) {
      noteDisconnectBreadcrumb(
        "disconnect",
        "sta",
        wifiStaDisconnectReasonLabel(g_staDisconnectReason),
        "STA uplink dropped and firmware scheduled an automatic reconnect.",
        g_staDisconnectReason,
        g_staRSSI,
        wifiGetApStationCount(),
        0,
        0
      );
      Serial.printf("[WIFI] STA lost (reason=%d), reconnecting...\n",
                    g_staDisconnectReason);
    }
    // Auto-reconnect if we have credentials
    if (g_staSSID.length() > 0) {
      esp_wifi_connect();
    }
  }

  // Handle got-IP event (from event handler)
  if (g_staGotIP) {
    g_staGotIP = false;
    g_staConnected = true;
    esp_netif_ip_info_t ip_info;
    esp_netif_get_ip_info(g_staNetif, &ip_info);
    char ip_buf[16];
    snprintf(ip_buf, sizeof(ip_buf), IPSTR, IP2STR(&ip_info.ip));
    g_staIP = String(ip_buf);
    wifi_ap_record_t ap_info;
    if (esp_wifi_sta_get_ap_info(&ap_info) == ESP_OK) {
      g_staRSSI = ap_info.rssi;
    }
    Serial.println("[WIFI] STA reconnected: " + g_staIP);
  }

  if (g_apClientDisconnected) {
    g_apClientDisconnected = false;
    int clients = wifiGetApStationCount();
    noteDisconnectBreadcrumb(
      "disconnect",
      "ap",
      clients > 0 ? "ap_client_left_partial" : "ap_client_left_all",
      clients > 0
        ? "A browser/client dropped off the DPA access point while other AP clients remained connected."
        : "The last browser/client dropped off the DPA access point.",
      0,
      g_staRSSI,
      clients,
      0,
      0
    );
    if (clients == 0 && !g_apRecoveryPending) {
      g_apRecoveryPending = true;
      g_apRecoveryRequestedAtMs = millis();
      Serial.println("[WIFI] Last AP client left — scheduling AP/control-plane refresh");
    }
  }

  // Periodic RSSI update (~1 Hz, only when connected)
  if (g_staConnected) {
    uint32_t now = millis();
    if (now - g_lastRssiPollMs >= 1000) {
      g_lastRssiPollMs = now;
      wifi_ap_record_t ap_info;
      if (esp_wifi_sta_get_ap_info(&ap_info) == ESP_OK) {
        g_staRSSI = ap_info.rssi;
      }
    }
  }

  if (g_staJoinQueued) {
    g_staJoinQueued = false;
    bool ok = wifiConnectSTA();
    if (ok) {
      wifiSaveToNVS();
    } else {
      g_staSSID = "";
      g_staPassword = "";
    }
    g_staJoinPending = false;
  }
}

// ── Build Dynamic SSID from NVS metadata ─────────────────────
// Format: "Artist-Album-DPA" truncated to 32 chars
void wifiBuildSSID() {
  Preferences prefs;
  prefs.begin("dpa_meta", true);  // read-only
  g_metaArtist = prefs.getString("artist", "");
  g_metaAlbum  = prefs.getString("album", "");
  prefs.end();

  const String& artist = g_metaArtist;
  const String& album  = g_metaAlbum;

  if (artist.length() > 0 && album.length() > 0) {
    g_apSSID = artist + "-" + album + "-DPA";
  } else if (artist.length() > 0) {
    g_apSSID = artist + "-DPA";
  } else {
    g_apSSID = DPA_AP_SSID_DEFAULT;
  }

  // Truncate to 32 chars (WiFi SSID limit)
  if (g_apSSID.length() > 32) {
    g_apSSID = g_apSSID.substring(0, 29) + "DPA";
  }
}

// ── Save artist/album metadata to NVS for SSID ──────────────
void wifiSetMetadata(const String& artist, const String& album) {
  Preferences prefs;
  prefs.begin("dpa_meta", false);
  prefs.putString("artist", artist);
  prefs.putString("album", album);
  prefs.end();

  String previousSSID = g_apSSID;
  wifiBuildSSID();
  Serial.printf("[WIFI] Metadata saved: artist=%s album=%s ssid=%s\n",
    artist.c_str(), album.c_str(), g_apSSID.c_str());

  // Re-broadcast AP with new SSID if it changed
  if (g_apPassword.length() > 0 && previousSSID != g_apSSID) {
    Serial.printf("[WIFI] Re-broadcasting AP: %s -> %s\n",
      previousSSID.c_str(), g_apSSID.c_str());

    wifi_config_t ap_cfg = {};
    strncpy((char*)ap_cfg.ap.ssid, g_apSSID.c_str(),
            sizeof(ap_cfg.ap.ssid) - 1);
    ap_cfg.ap.ssid_len = g_apSSID.length();
    strncpy((char*)ap_cfg.ap.password, g_apPassword.c_str(),
            sizeof(ap_cfg.ap.password) - 1);
    ap_cfg.ap.channel = g_apChannelRef;
    ap_cfg.ap.max_connection = g_apMaxConnRef;
    ap_cfg.ap.authmode = g_apPassword.length() > 0
                           ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
    ap_cfg.ap.beacon_interval = 100;
    esp_wifi_set_config(WIFI_IF_AP, &ap_cfg);
  }
}

// Read-only accessors so status/API handlers never touch NVS on hot paths
const String& wifiGetArtist() { return g_metaArtist; }
const String& wifiGetAlbum()  { return g_metaAlbum;  }
const String& wifiGetApSSID() { return g_apSSID;     }

// ── Init: Setup AP+STA ──────────────────────────────────────
void wifiInit(const char* apPassword, int apChannel, int apMaxConn) {
  // Cache AP creds for live SSID re-broadcast
  g_apPassword   = String(apPassword);
  g_apChannelRef = apChannel;
  g_apMaxConnRef = apMaxConn;

  // Load saved STA credentials
  wifiLoadFromNVS();

  // Build dynamic SSID from stored metadata
  wifiBuildSSID();

  // ── WiFi init: Use Arduino WiFi.softAP() + WiFi.enableSTA() to
  // let the framework handle netif creation and driver init, then
  // layer ESP-IDF event handlers + power control on top. ──
  WiFi.mode(WIFI_MODE_APSTA);
  WiFi.softAP(g_apSSID.c_str(), apPassword, apChannel, 0, apMaxConn);
  WiFi.setSleep(false);  // WIFI_PS_NONE — prevents AP client drops

  // Get netif handles for ESP-IDF accessors (IP info, station count)
  g_apNetif  = esp_netif_get_handle_from_ifkey("WIFI_AP_DEF");
  g_staNetif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");

  // Register our event handlers for disconnect reason codes + AP client tracking
  esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID,
                             &wifiEventHandler, NULL);
  esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP,
                             &wifiEventHandler, NULL);

  // Also force PS_NONE at ESP-IDF level for certainty
  esp_wifi_set_ps(WIFI_PS_NONE);

  Serial.println("[WIFI] AP started! (Arduino + ESP-IDF hybrid)");
  Serial.println("[WIFI] SSID: " + g_apSSID);
  Serial.println("[WIFI] Pass: " + String(apPassword));
  Serial.println("[WIFI] AP IP: " + WiFi.softAPIP().toString());

  // If we have stored STA credentials, connect automatically
  if (g_staSSID.length() > 0) {
    wifiConnectSTA();
  }
}

#endif // DPA_WIFI_H
