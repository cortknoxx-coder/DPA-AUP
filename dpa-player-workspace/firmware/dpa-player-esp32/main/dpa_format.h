/*
 * DPA Player — DPA1 container parser (pure C)
 * --------------------------------------------
 * Binary layout identical to the DPA Album reference
 * (arduino-src/dpa_format.h) so Album exports are byte-for-byte
 * compatible with Player imports. Little-endian on the wire.
 *
 *   off  size  field
 *   0    4     magic = "DPA1"
 *   4    1     version (currently 1)
 *   5    1     flags  (bit0=audio, bit1=video, bit2=capsule, bit3=encrypted)
 *   6    2     headerSize  (u16, total header bytes incl. this u16 itself)
 *   8    4     payloadFormat (u32 enum: 1=WAV, 2=PCM, 3=FLAC, 4=OPUS, 5=JSON)
 *   12   4     sampleRate  (Hz)
 *   16   2     channels
 *   18   2     bitsPerSample
 *   20   4     durationMs
 *   24   4     payloadSize (bytes)
 *   28   96    title            (NUL-padded UTF-8)
 *   124  96    originalFilename (NUL-padded UTF-8)
 *   220  N     payload (format-specific)
 */

#ifndef DPA_PLAYER_DPA_FORMAT_H
#define DPA_PLAYER_DPA_FORMAT_H

#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>

#ifdef __cplusplus
extern "C" {
#endif

#define DPA1_VERSION        1
#define DPA_TITLE_BYTES     96
#define DPA_FILENAME_BYTES  96
#define DPA_HEADER_BYTES    (4 + 1 + 1 + 2 + 4 + 4 + 2 + 2 + 4 + 4 \
                             + DPA_TITLE_BYTES + DPA_FILENAME_BYTES)

/* Flags */
#define DPA_FLAG_AUDIO      0x01
#define DPA_FLAG_VIDEO      0x02
#define DPA_FLAG_CAPSULE    0x04
#define DPA_FLAG_ENCRYPTED  0x08

/* Payload formats — u32 on the wire. */
typedef enum {
    DPA_PAYLOAD_WAV  = 1,
    DPA_PAYLOAD_PCM  = 2,
    DPA_PAYLOAD_FLAC = 3,
    DPA_PAYLOAD_OPUS = 4,
    DPA_PAYLOAD_JSON = 5,
} dpa_payload_format_t;

typedef struct {
    bool     valid;
    uint8_t  version;
    uint8_t  flags;
    uint16_t header_size;
    uint32_t payload_format;
    uint32_t sample_rate;
    uint16_t channels;
    uint16_t bits_per_sample;
    uint32_t duration_ms;
    uint32_t payload_size;
    char     title[DPA_TITLE_BYTES + 1];             /* NUL-terminated */
    char     original_filename[DPA_FILENAME_BYTES + 1];
} dpa_file_header_t;

/* Parses the DPA1 header from an already-opened file. Leaves the
 * file pointer at the start of the payload on success. Returns
 * true on valid DPA1 frame, false on magic/version mismatch or
 * short read. All fields in *out are zeroed on failure. */
bool dpa_format_read_header(FILE *f, dpa_file_header_t *out);

/* Convenience: open the given absolute path, read the header,
 * close the file. Returns the same bool as dpa_format_read_header. */
bool dpa_format_probe_file(const char *path, dpa_file_header_t *out);

/* Returns the offset into the file where the payload starts. */
static inline uint32_t dpa_format_payload_offset(const dpa_file_header_t *h)
{
    return h ? h->header_size : 0;
}

/* Returns a short ASCII label for a payload format, e.g. "FLAC". */
const char *dpa_format_payload_name(uint32_t fmt);

#ifdef __cplusplus
}
#endif

#endif /* DPA_PLAYER_DPA_FORMAT_H */
