/*
 * DPA Captive Portal — captive.h
 * DNS hijack for automatic portal launch on phone WiFi connect
 *
 * When a phone connects to the DPA WiFi AP, the OS probes known URLs
 * to detect captive portals. We intercept ALL DNS queries and resolve
 * them to 192.168.4.1, then redirect probe URLs to the dashboard.
 *
 * Supported platforms:
 *   iOS/macOS:  GET /hotspot-detect.html → 302 to /
 *   Android:    GET /generate_204        → 302 to /
 *   Windows:    GET /connecttest.txt     → 302 to /
 *   Generic:    GET /redirect            → 302 to /
 *
 * RAM cost: ~2KB (DNSServer instance + buffer)
 */

#ifndef DPA_CAPTIVE_H
#define DPA_CAPTIVE_H

#include <DNSServer.h>
#include <WiFi.h>

static DNSServer g_dnsServer;
static const uint16_t DNS_PORT = 53;

// ── Init: start DNS server that resolves ALL queries to AP IP ──
void captiveInit() {
  IPAddress apIP = WiFi.softAPIP();
  g_dnsServer.setErrorReplyCode(DNSReplyCode::NoError);
  g_dnsServer.start(DNS_PORT, "*", apIP);
  Serial.printf("[CAPTIVE] DNS hijack active — all queries → %s\n", apIP.toString().c_str());
}

// ── Tick: process DNS queries (call from main loop) ──
void captiveTick() {
  g_dnsServer.processNextRequest();
}

// ── Register captive portal probe redirects on the web server ──
// Call this BEFORE server.begin() in setup
void captiveRegisterProbes(AsyncWebServer& server) {
  // iOS / macOS probe
  server.on("/hotspot-detect.html", HTTP_GET, [](AsyncWebServerRequest* req) {
    Serial.println("[CAPTIVE] iOS probe → redirect to /");
    req->redirect("http://192.168.4.1/");
  });

  // Android probe
  server.on("/generate_204", HTTP_GET, [](AsyncWebServerRequest* req) {
    Serial.println("[CAPTIVE] Android probe → redirect to /");
    req->redirect("http://192.168.4.1/");
  });

  // Windows probe
  server.on("/connecttest.txt", HTTP_GET, [](AsyncWebServerRequest* req) {
    Serial.println("[CAPTIVE] Windows probe → redirect to /");
    req->redirect("http://192.168.4.1/");
  });

  // Generic fallback probe
  server.on("/redirect", HTTP_GET, [](AsyncWebServerRequest* req) {
    req->redirect("http://192.168.4.1/");
  });

  // Android generates connectivity checks to various Google domains
  server.on("/gen_204", HTTP_GET, [](AsyncWebServerRequest* req) {
    req->redirect("http://192.168.4.1/");
  });

  // Some Android versions check this
  server.on("/ncsi.txt", HTTP_GET, [](AsyncWebServerRequest* req) {
    req->redirect("http://192.168.4.1/");
  });

  // Apple CNA fallback
  server.on("/library/test/success.html", HTTP_GET, [](AsyncWebServerRequest* req) {
    req->redirect("http://192.168.4.1/");
  });

  Serial.println("[CAPTIVE] Probe redirects registered (iOS/Android/Windows)");
}

#endif // DPA_CAPTIVE_H
