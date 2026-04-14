import { Redis } from '@upstash/redis';

let _redis;
function getRedis() {
  if (!_redis) {
    _redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return _redis;
}

const HEARTBEAT_TTL = 120;
const SESSION_TTL = 12 * 60 * 60;
const ONLINE_SET_KEY = 'dpa:online_devices';
const RATE_PREFIX = 'dpa:rate:';

export async function setDeviceHeartbeat(duid, data) {
  const redis = getRedis();
  const key = `dpa:heartbeat:${duid}`;
  const pipeline = redis.pipeline();
  pipeline.set(key, JSON.stringify(data), { ex: HEARTBEAT_TTL });
  pipeline.zadd(ONLINE_SET_KEY, { score: Date.now(), member: duid });
  await pipeline.exec();
}

export async function getDeviceHeartbeat(duid) {
  const raw = await getRedis().get(`dpa:heartbeat:${duid}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

export async function getOnlineDevices() {
  const cutoff = Date.now() - (HEARTBEAT_TTL * 1000);
  await getRedis().zremrangebyscore(ONLINE_SET_KEY, 0, cutoff);
  return getRedis().zrange(ONLINE_SET_KEY, 0, -1);
}

export async function setOperatorSession(token, session) {
  await getRedis().set(`dpa:session:${token}`, JSON.stringify(session), { ex: SESSION_TTL });
}

export async function getOperatorSession(token) {
  const raw = await getRedis().get(`dpa:session:${token}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

export async function deleteOperatorSession(token) {
  await getRedis().del(`dpa:session:${token}`);
}

export async function checkRateLimit(ip, maxPerMinute = 60) {
  const key = `${RATE_PREFIX}${ip}`;
  const redis = getRedis();
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, 60);
  }
  return current <= maxPerMinute;
}
