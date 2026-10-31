// Rate limiting on Node: the `limit({key}) -> {success}` shape of Cloudflare's rate-limit binding,
// counted in fixed windows in this process's memory (like the binding, approximate and local:
// several server processes would each allow `limit` per window).
export class MemoryRateLimiter {
  constructor({ limit, period }) {
    this.max = limit;
    this.periodMs = period * 1000;
    this.windows = new Map();
  }
  async limit({ key }) {
    const now = Date.now();
    let window = this.windows.get(key);
    if (!window || now - window.start >= this.periodMs) {
      if (this.windows.size > 50_000) this.sweep(now);
      window = { start: now, count: 0 };
      this.windows.set(key, window);
    }
    window.count++;
    return { success: window.count <= this.max };
  }
  sweep(now) {
    for (const [key, window] of this.windows)
      if (now - window.start >= this.periodMs) this.windows.delete(key);
  }
}
