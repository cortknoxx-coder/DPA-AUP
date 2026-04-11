/*
 * DPA Player — Captive portal DNS hijack
 * Pure ESP-IDF. No Arduino DNSServer.
 */

#ifndef DPA_PLAYER_CAPTIVE_DNS_H
#define DPA_PLAYER_CAPTIVE_DNS_H

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Starts a FreeRTOS task that binds UDP/53 on the SoftAP interface
 * and answers every A-record query with DPA_PLAYER_AP_IP. This is
 * what makes phones show the "Sign in to this network" captive
 * portal banner on connect. */
esp_err_t dpa_captive_dns_start(void);

/* Stops the DNS hijack task. Safe to call if not started. */
void dpa_captive_dns_stop(void);

#ifdef __cplusplus
}
#endif

#endif /* DPA_PLAYER_CAPTIVE_DNS_H */
