// Redis on Vercel: room leases with fencing tokens, the live socket registry, the per-instance
// delivery channels and rate-limit counters. One command connection and one subscriber connection
// per function instance (any Redis 6.2+ reachable over TCP: Redis Cloud or Upstash from the
// Vercel Marketplace, or a self-hosted server). Keys use the `vz:` prefix.
import { createClient } from "redis";

/** Lua: take the lease when it is free and return the room's live sockets (dead instances pruned). */
const ACQUIRE = `
if redis.call('EXISTS', KEYS[1]) == 1 then return {0, redis.call('PTTL', KEYS[1])} end
local fence = redis.call('INCR', KEYS[2])
redis.call('SET', KEYS[1], ARGV[1] .. ':' .. fence, 'PX', ARGV[2])
local entries = redis.call('HGETALL', KEYS[3])
local live = {}
for i = 1, #entries, 2 do
  local instance = string.match(entries[i + 1], '^([^|]+)|')
  if instance and redis.call('EXISTS', ARGV[3] .. instance) == 1 then
    live[#live + 1] = entries[i]
    live[#live + 1] = entries[i + 1]
  else
    redis.call('HDEL', KEYS[3], entries[i])
  end
end
return {1, fence, live}`;
/** Lua: extend the lease if this holder still has it. */
const RENEW = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return 0`;
/** Lua: release the lease if this holder still has it. */
const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;
/** Lua: raise the fence counter to at least ARGV[1] (after Redis lost its data). */
const RAISE = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current < tonumber(ARGV[1]) then redis.call('SET', KEYS[1], ARGV[1]) end
return 1`;
/** Lua: one fixed-window rate-limit hit; returns the count in the window. */
const HIT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count`;

export const keys = {
  lease: (actor) => `vz:lease:${actor}`,
  fence: (actor) => `vz:fence:${actor}`,
  sockets: (actor) => `vz:sockets:${actor}`,
  alivePrefix: "vz:alive:",
  alive: (instance) => `vz:alive:${instance}`,
  channel: (instance) => `vz:i:${instance}`,
};

export class RedisConnection {
  constructor(url) {
    if (!url) throw new Error("REDIS_URL is required for the vercel runtime");
    this.url = url;
    this.client = createClient({ url });
    this.client.on("error", (error) => console.error("redis", error?.message));
    this.ready = this.client.connect();
  }

  /** A second connection for SUBSCRIBE (a subscribed connection cannot run other commands). */
  async subscriber() {
    const client = this.client.duplicate();
    client.on("error", (error) => console.error("redis subscriber", error?.message));
    await client.connect();
    return client;
  }

  async acquire(actor, holder, ttlMs) {
    const [taken, value, live] = await this.client.eval(ACQUIRE, {
      keys: [keys.lease(actor), keys.fence(actor), keys.sockets(actor)],
      arguments: [holder, String(ttlMs), keys.alivePrefix],
    });
    if (!taken) return { taken: false, wait: Number(value) };
    const sockets = new Map();
    for (let i = 0; i < live.length; i += 2) sockets.set(live[i], live[i + 1]);
    return { taken: true, fence: Number(value), token: `${holder}:${value}`, sockets };
  }
  async renew(actor, token, ttlMs) {
    return (
      (await this.client.eval(RENEW, {
        keys: [keys.lease(actor)],
        arguments: [token, String(ttlMs)],
      })) === 1
    );
  }
  async raiseFence(actor, fence) {
    await this.client.eval(RAISE, { keys: [keys.fence(actor)], arguments: [String(fence)] });
  }
  /** Commands of a MULTI that ends a turn: deliveries, registry changes, then the release. */
  finishTurn({ actor, token, publish, set, remove }) {
    const multi = this.client.multi();
    for (const [channel, message] of publish) multi.publish(channel, message);
    if (set.size) multi.hSet(keys.sockets(actor), Object.fromEntries(set));
    if (remove.size) multi.hDel(keys.sockets(actor), [...remove]);
    if (token) multi.eval(RELEASE, { keys: [keys.lease(actor)], arguments: [token] });
    return multi.exec();
  }
  async release(actor, token) {
    await this.client.eval(RELEASE, { keys: [keys.lease(actor)], arguments: [token] });
  }
  async heartbeat(instance, ttlMs) {
    await this.client.set(keys.alive(instance), "1", { PX: ttlMs });
  }
  async hit(key, periodMs) {
    return Number(await this.client.eval(HIT, { keys: [key], arguments: [String(periodMs)] }));
  }
  async close() {
    try {
      await this.client.quit();
    } catch {}
  }
}

/**
 * Rate limiting shared by every instance: the `limit({key}) -> {success}` shape of Cloudflare's
 * rate-limit binding, counted in fixed windows in Redis.
 */
export class RedisRateLimiter {
  constructor(redis, name, { limit, period }) {
    this.redis = redis;
    this.name = name;
    this.max = limit;
    this.periodMs = period * 1000;
  }
  async limit({ key }) {
    const window = Math.floor(Date.now() / this.periodMs);
    const count = await this.redis.hit(`vz:rl:${this.name}:${window}:${key}`, this.periodMs);
    return { success: count <= this.max };
  }
}
