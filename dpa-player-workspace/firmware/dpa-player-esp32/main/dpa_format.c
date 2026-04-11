/*
 * DPA Player — DPA1 container parser (pure C)
 * Mirrors the Album reference in arduino-src/dpa_format.h without
 * touching any Arduino types (no String, no Stream).
 */

#include "dpa_format.h"

#include <string.h>

static const uint8_t DPA1_MAGIC[4] = { 'D', 'P', 'A', '1' };

/* Little-endian 16-bit reader. */
static inline uint16_t rd16(FILE *f)
{
    uint8_t b[2] = {0, 0};
    if (fread(b, 1, 2, f) != 2) return 0;
    return (uint16_t)(b[0] | ((uint16_t)b[1] << 8));
}

/* Little-endian 32-bit reader. */
static inline uint32_t rd32(FILE *f)
{
    uint8_t b[4] = {0, 0, 0, 0};
    if (fread(b, 1, 4, f) != 4) return 0;
    return ((uint32_t)b[0])        |
           ((uint32_t)b[1] <<  8)  |
           ((uint32_t)b[2] << 16)  |
           ((uint32_t)b[3] << 24);
}

/* Reads a fixed-width NUL-padded string of exactly field_bytes bytes
 * into out[field_bytes + 1], guaranteeing NUL termination. Returns
 * the number of bytes actually stored in out (excluding terminator). */
static size_t rd_fixed_str(FILE *f, char *out, size_t field_bytes)
{
    uint8_t buf[DPA_TITLE_BYTES] = {0};
    size_t n = field_bytes > sizeof(buf) ? sizeof(buf) : field_bytes;
    if (fread(buf, 1, n, f) != n) {
        out[0] = '\0';
        return 0;
    }
    size_t len = 0;
    while (len < n && buf[len] != 0) len++;
    memcpy(out, buf, len);
    out[len] = '\0';
    return len;
}

bool dpa_format_read_header(FILE *f, dpa_file_header_t *out)
{
    if (!f || !out) return false;
    memset(out, 0, sizeof(*out));

    if (fseek(f, 0, SEEK_SET) != 0) return false;

    uint8_t magic[4] = {0};
    if (fread(magic, 1, 4, f) != 4) return false;
    if (memcmp(magic, DPA1_MAGIC, 4) != 0) return false;

    uint8_t byte = 0;
    if (fread(&byte, 1, 1, f) != 1) return false;
    out->version = byte;
    if (fread(&byte, 1, 1, f) != 1) return false;
    out->flags = byte;

    out->header_size     = rd16(f);
    out->payload_format  = rd32(f);
    out->sample_rate     = rd32(f);
    out->channels        = rd16(f);
    out->bits_per_sample = rd16(f);
    out->duration_ms     = rd32(f);
    out->payload_size    = rd32(f);

    rd_fixed_str(f, out->title,             DPA_TITLE_BYTES);
    rd_fixed_str(f, out->original_filename, DPA_FILENAME_BYTES);

    if (out->version     != DPA1_VERSION)    return false;
    if (out->header_size <  DPA_HEADER_BYTES) return false;
    if (out->payload_size == 0)               return false;

    /* Leave the file pointer at the payload start so the caller can
     * start streaming audio without another fseek. */
    if (fseek(f, out->header_size, SEEK_SET) != 0) return false;

    out->valid = true;
    return true;
}

bool dpa_format_probe_file(const char *path, dpa_file_header_t *out)
{
    if (!path || !out) return false;
    FILE *f = fopen(path, "rb");
    if (!f) {
        memset(out, 0, sizeof(*out));
        return false;
    }
    bool ok = dpa_format_read_header(f, out);
    fclose(f);
    return ok;
}

const char *dpa_format_payload_name(uint32_t fmt)
{
    switch (fmt) {
    case DPA_PAYLOAD_WAV:  return "WAV";
    case DPA_PAYLOAD_PCM:  return "PCM";
    case DPA_PAYLOAD_FLAC: return "FLAC";
    case DPA_PAYLOAD_OPUS: return "OPUS";
    case DPA_PAYLOAD_JSON: return "JSON";
    default:               return "UNKNOWN";
    }
}
