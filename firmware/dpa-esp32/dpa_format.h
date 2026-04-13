#ifndef DPA_FORMAT_H
#define DPA_FORMAT_H

#include <Arduino.h>
#include <FS.h>

// DPA1 media container magic.
static const uint8_t DPA1_MAGIC_BYTES[4] = { 'D', 'P', 'A', '1' };
static const uint8_t DPA1_VERSION = 1;

// Content flags (reserve bits for future encryption / ownership / signing).
static const uint8_t DPA_FLAG_AUDIO = 0x01;
static const uint8_t DPA_FLAG_VIDEO = 0x02;
static const uint8_t DPA_FLAG_CAPSULE = 0x04;
static const uint8_t DPA_FLAG_ENCRYPTED = 0x08;

enum DpaPayloadFormat : uint32_t {
  DPA_PAYLOAD_WAV  = 1,
  DPA_PAYLOAD_PCM  = 2,
  DPA_PAYLOAD_FLAC = 3,
  DPA_PAYLOAD_OPUS = 4,
  DPA_PAYLOAD_JSON = 5,
};

static const size_t DPA_TITLE_BYTES = 96;
static const size_t DPA_FILENAME_BYTES = 96;
static const size_t DPA_HEADER_BYTES =
  4 + // magic
  1 + // version
  1 + // flags
  2 + // header size
  4 + // payload format
  4 + // sample rate
  2 + // channels
  2 + // bits per sample
  4 + // duration ms
  4 + // payload size
  DPA_TITLE_BYTES +
  DPA_FILENAME_BYTES;

static const size_t DPA_ARTIST_BYTES = 64;
static const size_t DPA_ALBUM_BYTES = 64;
static const size_t DPA_ISRC_BYTES = 16;
static const size_t DPA_GENRE_BYTES = 32;
static const size_t DPA_LABEL_BYTES = 64;
static const size_t DPA_COPYRIGHT_BYTES = 64;
static const size_t DPA_HEADER_BYTES_V2 =
  DPA_HEADER_BYTES +
  DPA_ARTIST_BYTES +
  DPA_ALBUM_BYTES +
  DPA_ISRC_BYTES +
  DPA_GENRE_BYTES +
  DPA_LABEL_BYTES +
  DPA_COPYRIGHT_BYTES;

struct DpaFileHeader {
  uint8_t version;
  uint8_t flags;
  uint16_t headerSize;
  uint32_t payloadFormat;
  uint32_t sampleRate;
  uint16_t channels;
  uint16_t bitsPerSample;
  uint32_t durationMs;
  uint32_t payloadSize;
  String title;
  String originalFilename;
  String artist;
  String album;
  String isrc;
  String genre;
  String recordLabel;
  String copyright;
  bool valid;
};

static inline uint16_t dpaRd16(File& f) {
  uint8_t b[2] = {0, 0};
  if (f.read(b, 2) != 2) return 0;
  return (uint16_t)(b[0] | (b[1] << 8));
}

static inline uint32_t dpaRd32(File& f) {
  uint8_t b[4] = {0, 0, 0, 0};
  if (f.read(b, 4) != 4) return 0;
  return (uint32_t)(b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24));
}

static inline String dpaReadFixedString(File& f, size_t maxBytes) {
  uint8_t buf[96];
  size_t remaining = maxBytes;
  String out = "";
  bool terminated = false;
  while (remaining > 0) {
    size_t chunk = remaining > sizeof(buf) ? sizeof(buf) : remaining;
    if ((size_t)f.read(buf, chunk) != chunk) return "";
    if (!terminated) {
      for (size_t i = 0; i < chunk; i++) {
        if (buf[i] == 0) { terminated = true; break; }
        out += (char)buf[i];
      }
    }
    remaining -= chunk;
  }
  return out;
}

static inline bool dpaReadHeader(File& f, DpaFileHeader& out) {
  out = {0, 0, 0, 0, 0, 0, 0, 0, 0, "", "", "", "", "", "", "", "", false};
  f.seek(0);

  uint8_t magic[4] = {0, 0, 0, 0};
  if (f.read(magic, 4) != 4) return false;
  if (memcmp(magic, DPA1_MAGIC_BYTES, 4) != 0) return false;

  out.version = (uint8_t)f.read();
  out.flags = (uint8_t)f.read();
  out.headerSize = dpaRd16(f);
  out.payloadFormat = dpaRd32(f);
  out.sampleRate = dpaRd32(f);
  out.channels = dpaRd16(f);
  out.bitsPerSample = dpaRd16(f);
  out.durationMs = dpaRd32(f);
  out.payloadSize = dpaRd32(f);
  out.title = dpaReadFixedString(f, DPA_TITLE_BYTES);
  out.originalFilename = dpaReadFixedString(f, DPA_FILENAME_BYTES);

  if (out.version != DPA1_VERSION) return false;
  if (out.headerSize < DPA_HEADER_BYTES) return false;
  if (out.payloadSize == 0) return false;

  if (out.headerSize >= DPA_HEADER_BYTES_V2) {
    out.artist = dpaReadFixedString(f, DPA_ARTIST_BYTES);
    out.album = dpaReadFixedString(f, DPA_ALBUM_BYTES);
    out.isrc = dpaReadFixedString(f, DPA_ISRC_BYTES);
    out.genre = dpaReadFixedString(f, DPA_GENRE_BYTES);
    out.recordLabel = dpaReadFixedString(f, DPA_LABEL_BYTES);
    out.copyright = dpaReadFixedString(f, DPA_COPYRIGHT_BYTES);
  }

  out.valid = true;
  return true;
}

static inline uint32_t dpaPayloadOffset(const DpaFileHeader& header) {
  return header.headerSize;
}

#endif // DPA_FORMAT_H
