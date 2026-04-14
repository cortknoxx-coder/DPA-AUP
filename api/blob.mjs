import { put, list, del } from '@vercel/blob';

export async function uploadFirmware(buffer, version) {
  const pathname = `firmware/dpa-${version}.bin`;
  const blob = await put(pathname, buffer, {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/octet-stream',
  });
  return blob;
}

export async function uploadArtwork(buffer, duid, filename) {
  const pathname = `artwork/${duid}/${filename}`;
  const blob = await put(pathname, buffer, {
    access: 'public',
    addRandomSuffix: false,
    contentType: guessImageMime(filename),
  });
  return blob;
}

export async function uploadBackup(jsonData, duid) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const pathname = `backups/${duid}/snapshot-${timestamp}.json`;
  const blob = await put(pathname, JSON.stringify(jsonData), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
  });
  return blob;
}

export async function getLatestBackup(duid) {
  const prefix = `backups/${duid}/`;
  const { blobs } = await list({ prefix });
  if (!blobs.length) return null;
  const sorted = blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  return sorted[0];
}

export async function uploadIngestFile(buffer, fileId, filename) {
  const pathname = `ingest/${fileId}/${filename}`;
  const blob = await put(pathname, buffer, {
    access: 'public',
    addRandomSuffix: false,
    contentType: guessMime(filename),
  });
  return blob;
}

export async function deleteBlob(url) {
  await del(url);
}

function guessImageMime(filename) {
  const ext = (filename || '').split('.').pop()?.toLowerCase();
  const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
  return map[ext] || 'image/png';
}

function guessMime(filename) {
  const ext = (filename || '').split('.').pop()?.toLowerCase();
  const map = { wav: 'audio/wav', mp3: 'audio/mpeg', flac: 'audio/flac', dpa: 'application/x-dpa', json: 'application/json', bin: 'application/octet-stream' };
  return map[ext] || 'application/octet-stream';
}
