import { createClient } from '@vercel/edge-config';

let client = null;

function getClient() {
  if (!client) {
    const connectionString = process.env.EDGE_CONFIG;
    if (!connectionString) return null;
    client = createClient(connectionString);
  }
  return client;
}

export async function getFeatureFlag(key) {
  const ec = getClient();
  if (!ec) return null;
  try {
    const flags = await ec.get('feature_flags');
    if (flags && typeof flags === 'object') return flags[key] ?? null;
    return null;
  } catch {
    return null;
  }
}

export async function getMaintenanceMode() {
  const ec = getClient();
  if (!ec) return false;
  try {
    return (await ec.get('maintenance_mode')) === true;
  } catch {
    return false;
  }
}

export async function getFirmwarePointer() {
  const ec = getClient();
  if (!ec) return null;
  try {
    return (await ec.get('firmware_stable_version')) || null;
  } catch {
    return null;
  }
}

export async function getPortalAnnouncement() {
  const ec = getClient();
  if (!ec) return '';
  try {
    return String((await ec.get('portal_announcement')) || '');
  } catch {
    return '';
  }
}

export async function edgeConfigStatus() {
  const ec = getClient();
  if (!ec) return { available: false, reason: 'no_connection_string' };
  try {
    const digest = await ec.digest();
    return { available: true, digest };
  } catch (e) {
    return { available: false, reason: String(e?.message || 'unknown') };
  }
}
