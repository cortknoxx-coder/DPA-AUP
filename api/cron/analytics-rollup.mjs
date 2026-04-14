import { query, queryOne, ensureSchema } from '../db.mjs';

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.CRON_SECRET) {
    res.statusCode = 401;
    res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }

  await ensureSchema();

  const results = { prunedSnapshots: 0, totalEvents: 0 };

  try {
    // Prune snapshot marker events older than 30 days
    const pruned = await query(
      "DELETE FROM device_events WHERE event_type IN ('snapshot_plays', 'snapshot_skips') AND created_at < now() - interval '30 days' RETURNING id"
    );
    results.prunedSnapshots = pruned.length;

    // Count total events for monitoring
    const countRow = await queryOne('SELECT COUNT(*)::int AS cnt FROM device_events');
    results.totalEvents = countRow?.cnt || 0;
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: String(e?.message || 'unknown') }));
    return;
  }

  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: true, ...results }));
}
