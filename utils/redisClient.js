const Redis = require("ioredis");

let redis;

// If REDIS_URL is provided, or we are in development, use Redis
if (process.env.REDIS_URL || process.env.NODE_ENV === "development") {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  console.log(`[Redis] Connecting to ${url}`);

  redis = new Redis(url, {
    // optional config
  });

  redis.on("error", (err) => {
    console.error("[Redis] Error:", err.message);
  });
} else {
  // Production fallback to In-Memory Store
  console.warn(
    "⚠️ [Redis] REDIS_URL not found on production, falling back to In-Memory Store.",
  );

  const memoryStore = new Map();

  redis = {
    get: async (key) => {
      const item = memoryStore.get(key);
      if (!item) return null;
      if (item.expiry && Date.now() > item.expiry) {
        memoryStore.delete(key);
        return null;
      }
      return item.value;
    },
    set: async (key, value, ...args) => {
      let expiry = null;
      let nx = false;

      // Parse EX (expiry)
      const exIndex = args.indexOf("EX");
      if (exIndex !== -1 && args[exIndex + 1]) {
        expiry = Date.now() + args[exIndex + 1] * 1000;
      }

      // Parse NX (not exists)
      if (args.includes("NX")) {
        nx = true;
      }

      const existing = memoryStore.get(key);
      const isExpired =
        existing && existing.expiry && Date.now() > existing.expiry;

      if (nx && existing && !isExpired) {
        return null; // nx condition failed (key exists and is valid)
      }

      memoryStore.set(key, { value: String(value), expiry });
      return "OK";
    },
    del: async (key) => {
      memoryStore.delete(key);
      return 1;
    },
    on: () => {}, // Mock event listener
  };
}

module.exports = redis;
