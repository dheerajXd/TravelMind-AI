class TTLCache {
  constructor(ttlSeconds) {
    this.ttlMs = ttlSeconds * 1000;
    this.cache = new Map();
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  set(key, value) {
    this.cache.set(key, {
      value,
      expiry: Date.now() + this.ttlMs,
    });
  }
}

const makeCacheKey = (prefix, params) => {
  const parts = [prefix];
  for (const key of Object.keys(params).sort()) {
    if (params[key] !== undefined && params[key] !== null) {
      parts.push(`${key}=${params[key]}`);
    }
  }
  return parts.join(':');
};

const buildLocationString = (lat, lng) => {
  if (lat !== undefined && lat !== null && lng !== undefined && lng !== null) {
    return `${lat},${lng}`;
  }
  return null;
};

module.exports = {
  TTLCache,
  makeCacheKey,
  buildLocationString,
};
