import { query, queryOne, ensureSchema } from '../db.mjs';
import { getOnlineDevices } from '../redis.mjs';

const STALE_THRESHOLD_MS = 5 * 60 * 1000;
const OFFLINE_THRESHOLD_MS = 30 * 60 * 1000;
const SESSION_EXPIRY_BUFFER_MS = 0;

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.CRON_SECRET) {
    res.statusCode = 401;
    res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }

  await ensureSchema();

  const now = Date.now();
  const results = { devicesChecked: 0, markedStale: 0, markedOffline: 0, expiredSessions: 0, expiredUploads: 0 };

  try {
    const onlineSet = new Set(await getOnlineDevices());
    const devices = await query('SELECT device_id, last_seen_at FROM devices');
    results.devicesChecked = devices.length;

    for (const d of devices) {
      if (onlineSet.has(d.device_id)) continue;
      const lastSeen = d.last_seen_at ? new Date(d.last_seen_at).getTime() : 0;
      const age = now - lastSeen;
      if (age > OFFLINE_THRESHOLD_MS) {
        results.markedOffline++;
      } else if (age > STALE_THRESHOLD_MS) {
        results.markedStale++;
      }
    }

    // Clean expired operator sessions
    const expired = await query(
      "DELETE FROM operator_sessions WHERE expires_at < now() RETURNING session_id"
    );
    results.expiredSessions = expired.length;

    // Clean expired upload sessions
    const expiredUploads = await query(
      "DELETE FROM upload_sessions WHERE expires_at < now() AND status != 'completed' RETURNING id"
    );
    results.expiredUploads = expiredUploads.length;
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: String(e?.message || 'unknown') }));
    return;
  }

  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: true, ...results }));
}
