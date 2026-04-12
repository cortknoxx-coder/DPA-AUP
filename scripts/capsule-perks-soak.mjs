#!/usr/bin/env node
/**
 * Soak: capsule JSON + DCNP (perk) fields on the device HTTP API.
 * Uses POSIX-style URL paths only (forward slashes).
 *
 * Usage:
 *   DPA_SOAK_BASE=http://192.168.4.1 node scripts/capsule-perks-soak.mjs
 *   DPA_SOAK_BASE=http://192.168.4.1 DPA_SOAK_ITERATIONS=120 node scripts/capsule-perks-soak.mjs
 */
import { spawn } from 'node:child_process';
import { posix } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const base = (process.env.DPA_SOAK_BASE || 'http://192.168.4.1')
  .trim()
  .replace(/\\/g, '/')
  .replace(/\/$/, '');
const iterations = Math.max(1, Number(process.env.DPA_SOAK_ITERATIONS || 30));
const delayMs = Math.max(50, Number(process.env.DPA_SOAK_DELAY_MS || 400));

function deviceUrl(rel) {
  const r = rel.startsWith('/') ? rel : `/${rel}`;
  return new URL(posix.normalize(r), `${base}/`).toString();
}

async function fetchJson(rel, { timeoutMs = 8000 } = {}) {
  const u = deviceUrl(rel);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(u, { signal: ac.signal, cache: 'no-store' });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text: text.slice(0, 200) };
  } finally {
    clearTimeout(t);
  }
}

function assertDcnp(statusJson) {
  const d = statusJson?.dcnp;
  if (!d || typeof d !== 'object') {
    throw new Error('status missing dcnp object (perk colors)');
  }
  for (const k of ['concert', 'video', 'merch', 'signing', 'remix', 'other']) {
    if (typeof d[k] !== 'string' || !d[k].length) {
      throw new Error(`status.dcnp.${k} missing or empty`);
    }
  }
}

async function runDeviceSoak() {
  console.log(`[soak] device base=${base} iterations=${iterations}`);
  for (let i = 1; i <= iterations; i += 1) {
    const caps = await fetchJson('/api/capsules');
    if (!caps.ok) {
      throw new Error(`capsules HTTP ${caps.status} ${caps.text}`);
    }
    const list = Array.isArray(caps.json)
      ? caps.json
      : Array.isArray(caps.json?.capsules)
        ? caps.json.capsules
        : null;
    if (!list) {
      throw new Error('capsules response missing array or .capsules[]');
    }

    const st = await fetchJson('/api/status');
    if (!st.ok) {
      throw new Error(`status HTTP ${st.status} ${st.text}`);
    }
    assertDcnp(st.json);

    const led = await fetchJson('/api/led/preview?mode=0&color=FF0000&pattern=0&brightness=48');
    if (!led.ok) {
      throw new Error(`led preview HTTP ${led.status} ${led.text}`);
    }

    if (i % 10 === 0 || i === 1) {
      console.log(`[soak] ok iteration ${i}/${iterations} capsules=${list.length}`);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  console.log('[soak] device loop complete');
}

function runCapsuleOtaTests() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const testFile = posix.join('internal-ingest-api', 'capsule-ota.test.mjs');
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--test', testFile], {
      cwd: root,
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`capsule-ota tests exited ${code}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  await runCapsuleOtaTests();
  await runDeviceSoak();
  console.log('[soak] all stages passed');
}

main().catch((e) => {
  console.error('[soak] failed:', e?.message || e);
  process.exit(1);
});
