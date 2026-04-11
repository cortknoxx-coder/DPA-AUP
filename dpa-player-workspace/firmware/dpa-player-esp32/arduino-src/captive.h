/*
 * DPA Captive Portal — captive.h
 * DNS hijack for automatic portal launch on phone WiFi connect
 *
 * When a phone connects to the DPA WiFi AP, the OS probes known URLs
 * to detect captive portals. We intercept ALL DNS queries and resolve
 * them to 192.168.4.1, then respond with OS-specific expected responses.
 *
 * Supported platforms:
 *   iOS/macOS:  GET /hotspot-detect.html → 200 "Success" (triggers CNA sheet)
 *   Android:    GET /generate_204        → 302 to portal (signals captive)
 *   Windows:    GET /connecttest.txt     → 200 "Microsoft Connect Test"
 *
 * Why 302 for Android but 200 for iOS:
 *   iOS CNA opens when it gets a 200 that ISN'T the expected "Success" body,
 *     OR a 302 — but 302 to / makes iOS think portal is unresolved → disconnect.
 *     Returning 200 with "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>"
 *     tells iOS "portal resolved, stay connected" and the user already has the dashboard.
 *   Android expects 204 = "internet works" or non-204 = "captive portal".
 *     Returning 302 tells Android "captive portal detected" → opens browser to /.
 *
 * RAM cost: ~2KB (DNSServer instance + buffer)
 */

#ifndef DPA_CAPTIVE_H
#define DPA_CAPTIVE_H

#include <DNSServer.h>
#include <ESPAsyncWebServer.h>
#include "dpa_wifi.h"  // wifiGetApIPStr()

static DNSServer g_dnsServer;
static const uint16_t DNS_PORT = 53;

// ── Init: start DNS server that resolves ALL queries to AP IP ──
void captiveInit() {
  String apIP = wifiGetApIPStr();

  // Parse IP string back to IPAddress for DNSServer
  IPAddress ip;
  ip.fromString(apIP);

  g_dnsServer.setErrorReplyCode(DNSReplyCode::NoError);
  g_dnsServer.start(DNS_PORT, "*", ip);
  Serial.printf("[CAPTIVE] DNS hijack active — all queries → %s\n", apIP.c_str());
}

// ── Tick: process DNS queries (call from main loop) ──
void captiveTick() {
  g_dnsServer.processNextRequest();
}

// ── Register captive portal probe handlers on the web server ──
// Call this BEFORE server.begin() in setup
void captiveRegisterProbes(AsyncWebServer& server) {

  // ── iOS / macOS ──
  // iOS CNA sends GET /hotspot-detect.html
  // If response is 200 with the exact "Success" body, iOS considers
  // the network "working" and stays connected without showing a portal sheet.
  // If you want the CNA sheet to appear, return a DIFFERENT body — but that
  // risks iOS dropping the connection on some versions. Safest: return Success.
  server.on("/hotspot-detect.html", HTTP_GET, [](AsyncWebServerRequest* req) {
    Serial.println("[CAPTIVE] iOS probe → 200 Success (stay connected)");
    req->send(200, "text/html",
      "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>");
  });

  // Apple CNA fallback URL
  server.on("/library/test/success.html", HTTP_GET, [](AsyncWebServerRequest* req) {
    Serial.println("[CAPTIVE] Apple fallback probe → 200 Success");
    req->send(200, "text/html",
      "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>");
  });

  // ── Android ──
  // Android sends GET /generate_204 (or /gen_204)
  // Expects HTTP 204 = "internet works, no captive portal"
  // Returning 302 = "captive portal detected" → opens browser
  // We return 302 to open the dashboard, then on subsequent checks
  // Android will re-probe and we give 204 to confirm "resolved".
  // BUT: aggressive 302 causes disconnect loops. Safest: return 204
  // so Android thinks "internet works" and stays connected.
  // User navigates to 192.168.4.1 manually or via mDNS.
  server.on("/generate_204", HTTP_GET, [](AsyncWebServerRequest* req) {
    Serial.println("[CAPTIVE] Android probe → 204 No Content (stay connected)");
    req->send(204);
  });

  server.on("/gen_204", HTTP_GET, [](AsyncWebServerRequest* req) {
    Serial.println("[CAPTIVE] Android alt probe → 204");
    req->send(204);
  });

  // Google connectivity check (some Android versions)
  server.on("/connectivitycheck/gstatic/", HTTP_GET, [](AsyncWebServerRequest* req) {
    req->send(204);
  });

  // ── Windows ──
  // Windows NCSI sends GET /connecttest.txt, expects "Microsoft Connect Test"
  // and GET /ncsi.txt, expects "Microsoft NCSI"
  server.on("/connecttest.txt", HTTP_GET, [](AsyncWebServerRequest* req) {
    Serial.println("[CAPTIVE] Windows probe → 200 Microsoft Connect Test");
    req->send(200, "text/plain", "Microsoft Connect Test");
  });

  server.on("/ncsi.txt", HTTP_GET, [](AsyncWebServerRequest* req) {
    req->send(200, "text/plain", "Microsoft NCSI");
  });

  // Windows also checks this URL
  server.on("/redirect", HTTP_GET, [](AsyncWebServerRequest* req) {
    req->send(200, "text/plain", "OK");
  });

  // ── Fallback: any unknown host request gets redirected ──
  // This catches random domain probes that slip through
  // (e.g., captive.apple.com, clients3.google.com)
  // Only redirect if the Host header isn't our AP IP
  // NOTE: Don't register "/" here — let the main .ino dashboard handler do it.
  // AsyncWebServer uses first-match, so registering here would block the dashboard.
  server.on("/captive-check", HTTP_GET, [](AsyncWebServerRequest* req) {
    String host = req->host();
    String apIP = wifiGetApIPStr();
    if (host.length() > 0 && host != "192.168.4.1" && host != apIP) {
      Serial.printf("[CAPTIVE] Foreign host '%s' → redirect to AP\n", host.c_str());
      req->redirect("http://192.168.4.1/");
      return;
    }
    req->redirect("/");
  });

  Serial.println("[CAPTIVE] Probe handlers registered (iOS/Android/Windows)");
}

#endif // DPA_CAPTIVE_H
