/**
 * ParaplanCache — in-memory TTL cache for Paraplan API responses.
 */

export class ParaplanCache {
  constructor(ttlConfig = {}) {
    this.store = new Map();
    this.ttl = {
      schedule: ttlConfig.schedule || 5 * 60 * 1000,
      groups: ttlConfig.groups || 60 * 60 * 1000,
      teachers: ttlConfig.teachers || 60 * 60 * 1000,
      default: ttlConfig.default || 5 * 60 * 1000,
    };
    this.stats = { hits: 0, misses: 0, sets: 0 };
  }

  get(key, category = "default") {
    const entry = this.store.get(key);
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    const ttl = this.ttl[category] || this.ttl.default;
    if (Date.now() - entry.timestamp > ttl) {
      this.store.delete(key);
      this.stats.misses++;
      return null;
    }
    this.stats.hits++;
    return entry.data;
  }

  set(key, data, category = "default") {
    this.store.set(key, { data, category, timestamp: Date.now() });
    this.stats.sets++;
  }

  invalidate(pattern = null) {
    if (!pattern) {
      const count = this.store.size;
      this.store.clear();
      return count;
    }
    let count = 0;
    for (const key of this.store.keys()) {
      if (key.includes(pattern)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  getStats() {
    return {
      ...this.stats,
      size: this.store.size,
      hitRate:
        this.stats.hits + this.stats.misses > 0
          ? ((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100).toFixed(1) + "%"
          : "N/A",
    };
  }
}
