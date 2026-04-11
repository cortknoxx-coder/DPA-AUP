/*
 * DPA Player — Captive portal DNS server (pure ESP-IDF)
 * ------------------------------------------------------
 * Hand-rolled UDP/53 server that parses incoming DNS queries and
 * returns an A record pointing at DPA_PLAYER_AP_IP for every name.
 *
 * This replaces the Arduino DNSServer class that the DPA Album
 * reference tree uses in arduino-src/captive.h. We do it by hand
 * because pure ESP-IDF has no bundled DNS hijack helper and
 * pulling in lwIP's resolver would be overkill.
 *
 * DNS message format (RFC 1035 § 4.1):
 *
 *   Header  (12 bytes)
 *     id        2
 *     flags     2
 *     qdcount   2
 *     ancount   2
 *     nscount   2
 *     arcount   2
 *   Question
 *     qname    variable (label-length + labels, NUL-terminated)
 *     qtype     2
 *     qclass    2
 *   Answer (we append)
 *     name      2   (pointer to qname offset 0x0c)
 *     type      2   (A = 1)
 *     class     2   (IN = 1)
 *     ttl       4
 *     rdlength  2
 *     rdata     4   (IPv4)
 */

#include "captive_dns.h"
#include "config.h"

#include <string.h>
#include <errno.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"

static const char *TAG = "captive_dns";

#define DNS_MAX_LEN 512
#define DNS_HDR_LEN 12

static TaskHandle_t s_task = NULL;
static volatile bool s_running = false;

static int build_response(const uint8_t *req, int req_len,
                          uint8_t *out, int out_max,
                          uint32_t answer_ipv4_net)
{
    if (req_len < DNS_HDR_LEN + 5) {
        return -1; /* too short to be valid */
    }

    /* Walk the question section to find its length so we can copy
     * it verbatim into the response. */
    int qpos = DNS_HDR_LEN;
    while (qpos < req_len) {
        uint8_t label_len = req[qpos];
        if (label_len == 0) {
            qpos++;
            break;
        }
        if (label_len & 0xC0) {
            /* Compression pointer — legal but we don't need to
             * chase it; the question-section QNAME is always
             * uncompressed per RFC 1035 § 4.1.4. */
            qpos += 2;
            break;
        }
        qpos += 1 + label_len;
        if (qpos >= DNS_MAX_LEN) {
            return -1;
        }
    }
    if (qpos + 4 > req_len) {
        return -1; /* no QTYPE/QCLASS */
    }
    int question_len = qpos + 4 - DNS_HDR_LEN; /* bytes after header */

    /* Total response = header + question + 16-byte A answer. */
    int resp_len = DNS_HDR_LEN + question_len + 16;
    if (resp_len > out_max) {
        return -1;
    }

    /* Copy header + question. */
    memcpy(out, req, DNS_HDR_LEN + question_len);

    /* Rewrite flags: QR=1 (response), OPCODE=copied, AA=1, RA=0,
     * RCODE=0. Keep RD bit from the request. */
    uint16_t flags = 0x8400; /* QR=1, AA=1 */
    flags |= (req[2] & 0x01) << 8; /* preserve RD */
    out[2] = flags >> 8;
    out[3] = flags & 0xFF;

    /* Set ancount = 1, nscount = 0, arcount = 0. */
    out[6] = 0x00; out[7] = 0x01;
    out[8] = 0x00; out[9] = 0x00;
    out[10] = 0x00; out[11] = 0x00;

    /* Answer section starts at DNS_HDR_LEN + question_len. */
    uint8_t *ans = out + DNS_HDR_LEN + question_len;

    /* Name: compression pointer → offset 0x0c (start of question). */
    ans[0] = 0xC0;
    ans[1] = 0x0C;

    /* TYPE = A (1), CLASS = IN (1). */
    ans[2] = 0x00; ans[3] = 0x01;
    ans[4] = 0x00; ans[5] = 0x01;

    /* TTL = 60 seconds. */
    ans[6] = 0x00; ans[7] = 0x00;
    ans[8] = 0x00; ans[9] = 0x3C;

    /* RDLENGTH = 4. */
    ans[10] = 0x00; ans[11] = 0x04;

    /* RDATA = the AP's IPv4 in network byte order. */
    memcpy(ans + 12, &answer_ipv4_net, 4);

    return resp_len;
}

static void dns_task(void *arg)
{
    (void)arg;

    int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (sock < 0) {
        ESP_LOGE(TAG, "socket() failed errno=%d", errno);
        s_task = NULL;
        vTaskDelete(NULL);
        return;
    }

    struct sockaddr_in bind_addr = {0};
    bind_addr.sin_family      = AF_INET;
    bind_addr.sin_addr.s_addr = htonl(INADDR_ANY);
    bind_addr.sin_port        = htons(DPA_PLAYER_DNS_PORT);

    if (bind(sock, (struct sockaddr *)&bind_addr, sizeof(bind_addr)) < 0) {
        ESP_LOGE(TAG, "bind() failed errno=%d", errno);
        close(sock);
        s_task = NULL;
        vTaskDelete(NULL);
        return;
    }

    /* Pre-compute the answer address as a network-order uint32. */
    struct in_addr ans_ip;
    inet_aton(DPA_PLAYER_AP_IP, &ans_ip);
    uint32_t answer_ipv4_net = ans_ip.s_addr;

    ESP_LOGI(TAG, "DNS hijack listening on UDP/%d -> %s",
             DPA_PLAYER_DNS_PORT, DPA_PLAYER_AP_IP);

    uint8_t buf[DNS_MAX_LEN];
    uint8_t out[DNS_MAX_LEN];

    s_running = true;
    while (s_running) {
        struct sockaddr_in peer = {0};
        socklen_t peer_len = sizeof(peer);
        int n = recvfrom(sock, buf, sizeof(buf), 0,
                         (struct sockaddr *)&peer, &peer_len);
        if (n <= 0) {
            if (errno == EINTR) continue;
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }

        int resp_len = build_response(buf, n, out, sizeof(out),
                                      answer_ipv4_net);
        if (resp_len <= 0) {
            continue;
        }

        sendto(sock, out, resp_len, 0,
               (struct sockaddr *)&peer, peer_len);
    }

    close(sock);
    ESP_LOGI(TAG, "DNS hijack stopped");
    s_task = NULL;
    vTaskDelete(NULL);
}

esp_err_t dpa_captive_dns_start(void)
{
    if (s_task) {
        return ESP_OK; /* already running */
    }
    BaseType_t ok = xTaskCreate(dns_task, "captive_dns",
                                4096, NULL, 5, &s_task);
    if (ok != pdPASS) {
        ESP_LOGE(TAG, "xTaskCreate failed");
        return ESP_FAIL;
    }
    return ESP_OK;
}

void dpa_captive_dns_stop(void)
{
    s_running = false;
    /* Task exits on next recvfrom wake-up. */
}
