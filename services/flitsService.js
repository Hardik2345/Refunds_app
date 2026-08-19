const axios = require("axios");

const DEFAULT_CACHE_TTL_SECONDS = 30;

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function unavailableSummary(customerId, status = "unavailable") {
  return {
    customerId: customerId != null ? String(customerId) : null,
    status,
    availableBalance: null,
    totalDeducted: null,
    totalCredited: null,
    availableBalanceRaw: null,
    totalDeductedRaw: null,
    fetchedAt: null,
  };
}

function normalizeFlitsCashback(payload, customerId) {
  const availableBalanceRaw = toFiniteNumber(payload?.customer?.credits);
  const totalDeductedRaw = toFiniteNumber(
    payload?.customer?.total_spent_credits ?? payload?.total_spent_credits
  );

  if (availableBalanceRaw === null && totalDeductedRaw === null) {
    return unavailableSummary(customerId);
  }

  const availableBalance =
    availableBalanceRaw === null ? null : Math.abs(availableBalanceRaw) / 100;
  const totalDeducted =
    totalDeductedRaw === null ? null : Math.abs(totalDeductedRaw) / 100;
  const totalCredited =
    availableBalance !== null && totalDeducted !== null
      ? availableBalance + totalDeducted
      : null;

  return {
    customerId: String(customerId),
    status: "available",
    availableBalance,
    totalDeducted,
    totalCredited,
    availableBalanceRaw,
    totalDeductedRaw,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchFlitsCashback(customerId, options = {}) {
  const userId = options.userId || process.env.FLITS_USER_ID;
  const apiKey = options.apiKey || process.env.FLITS_API_KEY;
  const httpClient = options.httpClient || axios;

  if (!customerId) return unavailableSummary(customerId);
  if (!userId || !apiKey) return unavailableSummary(customerId, "not_configured");

  const url = `https://app.getflits.com/api/1/${userId}/${customerId}/credit/get_credit`;
  const response = await httpClient.get(url, { params: { token: apiKey } });
  return normalizeFlitsCashback(response?.data, customerId);
}

function redisCacheKey(tenantId, customerId) {
  return `flits:cashback:${tenantId || "platform"}:${customerId}`;
}

async function loadRedisSummary(tenantId, customerId) {
  try {
    const redis = require("../utils/redisClient");
    const cached = await redis.get(redisCacheKey(tenantId, customerId));
    return cached ? JSON.parse(cached) : null;
  } catch (_) {
    return null;
  }
}

async function storeRedisSummary(tenantId, customerId, summary, ttlSeconds) {
  if (summary.status !== "available") return;
  try {
    const redis = require("../utils/redisClient");
    await redis.set(
      redisCacheKey(tenantId, customerId),
      JSON.stringify(summary),
      "EX",
      ttlSeconds
    );
  } catch (_) {
    // Redis is an optimization here; a cache failure must not fail a preview.
  }
}

async function getFlitsCashback(options) {
  const {
    tenantId,
    customerId,
    requestCache,
    useRedisCache = false,
    cacheTtlSeconds = Number(process.env.FLITS_CACHE_TTL_SECONDS) || DEFAULT_CACHE_TTL_SECONDS,
    httpClient,
    userId,
    apiKey,
  } = options || {};

  if (!customerId) return unavailableSummary(customerId);

  const resolvedUserId = userId || process.env.FLITS_USER_ID;
  const resolvedApiKey = apiKey || process.env.FLITS_API_KEY;
  if (!resolvedUserId || !resolvedApiKey) {
    return unavailableSummary(customerId, "not_configured");
  }

  const resolvedCacheTtlSeconds =
    Number.isFinite(cacheTtlSeconds) && cacheTtlSeconds > 0
      ? cacheTtlSeconds
      : DEFAULT_CACHE_TTL_SECONDS;

  const requestKey = `flits:${customerId}`;
  if (requestCache?.has(requestKey)) return requestCache.get(requestKey);

  const lookup = (async () => {
    if (useRedisCache) {
      const cached = await loadRedisSummary(tenantId, customerId);
      if (cached) return cached;
    }

    try {
      const summary = await fetchFlitsCashback(customerId, {
        httpClient,
        userId: resolvedUserId,
        apiKey: resolvedApiKey,
      });
      if (useRedisCache) {
        await storeRedisSummary(tenantId, customerId, summary, resolvedCacheTtlSeconds);
      }
      return summary;
    } catch (_) {
      return unavailableSummary(customerId);
    }
  })();

  // Store the in-flight promise so concurrent previews share the same request.
  requestCache?.set(requestKey, lookup);
  return lookup;
}

module.exports = {
  fetchFlitsCashback,
  getFlitsCashback,
  normalizeFlitsCashback,
  unavailableSummary,
};
