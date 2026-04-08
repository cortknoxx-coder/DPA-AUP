/*
 * DPA WiFi Manager — dpa_wifi.h
 * Dual AP+STA mode: AP always on, STA joins home network when configured
 * NVS persistence for WiFi credentials
 */

#ifndef DPA_WIFI_H
#define DPA_WIFI_H

#include <WiFi.h>
#include <Preferences.h>
#include <esp_wifi.h>

// Default AP SSID fallback
#define DPA_AP_SSID_DEFAULT "DPA-Portal"

// Dynamic SSID built from artist-album metadata (max 32 chars)
static String g_apSSID = DPA_AP_SSID_DEFAULT;

// Cached artist/album metadata — populated by wifiBuildSSID() from NVS so the
// status JSON and any future readers don't have to hit Preferences each call.
static String g_metaArtist = "";
static String g_metaAlbum  = "";

// Stored AP credentials so we can re-raise the softAP when metadata changes.
static const char* g_apPasswordRef = nullptr;
static int         g_apChannelRef  = 6;
static int         g_apMaxConnRef  = 4;

// ── Extern Globals (defined in .ino) ─────────────────────────
extern String g_duid;

// ── WiFi STA State ──────────────────────────────────────────
String g_staSSID     = "";
String g_staPassword = "";
String g_staIP       = "";
bool   g_staConnected = false;
int    g_staRSSI     = 0;

// Scan results (held in memory after scan)
struct WifiNetwork {
  String ssid;
  int rssi;
  bool open;  // true if no encryption
};
static WifiNetwork g_scanResults[20];
static int g_scanCount = 0;
static bool g_scanning = false;

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
  WiFi.begin(g_staSSID.c_str(), g_staPassword.c_str());

  // Wait up to 10 seconds for connection
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    g_staConnected = true;
    g_staIP = WiFi.localIP().toString();
    g_staRSSI = WiFi.RSSI();
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
  WiFi.disconnect(false);  // don't erase credentials from ESP IDF
  g_staConnected = false;
  g_staIP = "";
  g_staRSSI = 0;
  Serial.println("[WIFI] STA disconnected");
}

// ── WiFi Scan (runs from loop, not from web handler) ─────────
static bool g_scanRequested = false;  // API sets this, loop() acts on it

void wifiRequestScan() {
  if (!g_scanning) {
    g_scanRequested = true;
  }
}

// Called from loop() — safe to block here
void wifiDoScan() {
  if (!g_scanRequested || g_scanning) return;
  g_scanRequested = false;
  g_scanning = true;
  g_scanCount = 0;

  Serial.println("[WIFI] Scanning networks (sync from loop)...");
  int n = WiFi.scanNetworks(false, false);  // synchronous scan
  if (n > 0) {
    g_scanCount = min(n, 20);
    for (int i = 0; i < g_scanCount; i++) {
      g_scanResults[i].ssid = WiFi.SSID(i);
      g_scanResults[i].rssi = WiFi.RSSI(i);
      g_scanResults[i].open = (WiFi.encryptionType(i) == WIFI_AUTH_OPEN);
    }
    Serial.printf("[WIFI] Found %d networks\n", g_scanCount);
  } else {
    Serial.printf("[WIFI] Scan returned %d\n", n);
  }
  WiFi.scanDelete();
  g_scanning = false;
}

// ── Update STA status (call from loop) ───────────────────────
void wifiTick() {
  if (g_staSSID.length() == 0) return;

  bool wasConnected = g_staConnected;
  g_staConnected = (WiFi.status() == WL_CONNECTED);

  if (g_staConnected) {
    g_staIP = WiFi.localIP().toString();
    g_staRSSI = WiFi.RSSI();
  }

  // Auto-reconnect if we dropped
  if (wasConnected && !g_staConnected) {
    Serial.println("[WIFI] STA connection lost, reconnecting...");
    WiFi.begin(g_staSSID.c_str(), g_staPassword.c_str());
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
// Persists to NVS, rebuilds the dynamic SSID, and — if the AP has already
// been started — re-raises softAP with the new name so the change is live
// immediately. Existing clients will briefly disconnect and reconnect.
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

  // Apply live if the SSID actually changed and the AP is already up
  if (g_apPasswordRef != nullptr && previousSSID != g_apSSID) {
    Serial.printf("[WIFI] Re-broadcasting AP: %s -> %s\n",
      previousSSID.c_str(), g_apSSID.c_str());
    WiFi.softAP(g_apSSID.c_str(), g_apPasswordRef, g_apChannelRef, 0, g_apMaxConnRef);
  }
}

// Read-only accessors so status/API handlers never touch NVS on hot paths
const String& wifiGetArtist() { return g_metaArtist; }
const String& wifiGetAlbum()  { return g_metaAlbum;  }
const String& wifiGetApSSID() { return g_apSSID;     }

// ── Init: Setup AP+STA ──────────────────────────────────────
void wifiInit(const char* apPassword, int apChannel, int apMaxConn) {
  // Cache AP creds so wifiSetMetadata() can re-raise softAP live later
  g_apPasswordRef = apPassword;
  g_apChannelRef  = apChannel;
  g_apMaxConnRef  = apMaxConn;

  // Load saved STA credentials
  wifiLoadFromNVS();

  // Build dynamic SSID from stored metadata
  wifiBuildSSID();

  // Set dual mode: AP always on + STA for home network
  WiFi.mode(WIFI_AP_STA);

  // Disable WiFi power saving — prevents AP from dropping clients
  esp_wifi_set_ps(WIFI_PS_NONE);

  WiFi.softAP(g_apSSID.c_str(), apPassword, apChannel, 0, apMaxConn);
  delay(100);

  // Maximize AP client retention — prevent disconnects
  wifi_config_t apConf;
  esp_wifi_get_config(WIFI_IF_AP, &apConf);
  apConf.ap.beacon_interval = 100;       // 100ms beacon
  apConf.ap.max_connection = apMaxConn;
  esp_wifi_set_config(WIFI_IF_AP, &apConf);

  // Keep WiFi radio active to prevent AP from dropping clients during playback
  // This may add slight noise on line-out but maintains connection stability
  WiFi.setSleep(false);

  IPAddress apIP = WiFi.softAPIP();
  Serial.println("[WIFI] AP started!");
  Serial.println("[WIFI] SSID: " + g_apSSID);
  Serial.println("[WIFI] Pass: " + String(apPassword));
  Serial.println("[WIFI] AP IP: " + apIP.toString());

  // If we have stored STA credentials, connect automatically
  if (g_staSSID.length() > 0) {
    wifiConnectSTA();
  }
}

#endif // DPA_WIFI_H
