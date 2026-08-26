const axios = require("axios");
const { convert } = require("html-to-text");

// Shopify serves requests for unsupported API versions with the oldest supported
// version, so this fallback only matters for tenants with no apiVersion set.
const DEFAULT_API_VERSION = "2025-10";
const DEFAULT_CACHE_TTL_SECONDS = 60;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

const EMPTY_PAGE_INFO = { hasNextPage: false, endCursor: null };

// Shopify's `message`/`secondaryMessage` are FormattedStrings (a small HTML
// subset). We flatten them server-side so the client never has to render
// untrusted markup.
const HTML_TO_TEXT_OPTIONS = {
  wordwrap: false,
  selectors: [
    { selector: "a", options: { ignoreHref: true } },
    { selector: "img", format: "skip" },
  ],
};

function toPlainText(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = convert(value, HTML_TO_TEXT_OPTIONS).replace(/\s+/g, " ").trim();
  return text || null;
}

function toOrderGid(orderId) {
  const raw = String(orderId);
  return raw.startsWith("gid://") ? raw : `gid://shopify/Order/${orderId}`;
}

function clampPageSize(limit) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(parsed), MAX_PAGE_SIZE);
}

function resolveApiVersion(tenant) {
  return tenant?.apiVersion || DEFAULT_API_VERSION;
}

function unavailableResult(status, error, details) {
  return {
    status,
    events: [],
    pageInfo: { ...EMPTY_PAGE_INFO },
    error: error || null,
    details: details || null,
  };
}

function buildEventsQuery() {
  return `
    query OrderTimeline($id: ID!, $first: Int!, $after: String) {
      order(id: $id) {
        id
        events(first: $first, after: $after, reverse: true) {
          pageInfo { hasNextPage endCursor }
          nodes {
            __typename
            id
            action
            createdAt
            message
            appTitle
            attributeToApp
            attributeToUser
            criticalAlert
            ... on BasicEvent {
              author
              secondaryMessage
            }
            ... on CommentEvent {
              rawMessage
              author { name email }
            }
          }
        }
      }
    }
  `;
}

// CommentEvent.author is a StaffMember!, BasicEvent.author is a plain String.
function normalizeAuthor(author) {
  if (!author) return null;
  if (typeof author === "string") return author.trim() || null;
  return author.name || author.email || null;
}

function normalizeEvent(node) {
  if (!node) return null;
  const isComment = node.__typename === "CommentEvent";
  return {
    id: node.id || null,
    type: isComment ? "comment" : "basic",
    action: node.action || null,
    createdAt: node.createdAt || null,
    // rawMessage is the comment as the staff member typed it; prefer it over the
    // HTML-wrapped `message` Shopify renders in admin.
    text: isComment
      ? toPlainText(node.rawMessage) || toPlainText(node.message)
      : toPlainText(node.message),
    secondaryText: toPlainText(node.secondaryMessage),
    author: normalizeAuthor(node.author),
    appTitle: node.appTitle || null,
    attributeToApp: node.attributeToApp === true,
    attributeToUser: node.attributeToUser === true,
    criticalAlert: node.criticalAlert === true,
  };
}

/**
 * Pure normalizer for an Admin GraphQL OrderTimeline response body.
 * Never throws — an unusable payload becomes an `unavailable` sentinel.
 */
function normalizeOrderEvents(payload) {
  if (payload?.errors?.length) {
    const messages = payload.errors.map((e) => e?.message).filter(Boolean);
    const denied = messages.some((m) => /access denied|not approved|read_all_orders/i.test(m));
    return unavailableResult(
      denied ? "forbidden" : "unavailable",
      messages[0] || "Shopify returned GraphQL errors.",
      payload.errors
    );
  }

  const order = payload?.data?.order;
  // A null order means it does not exist, or this token cannot see it (Shopify
  // returns null rather than an error for orders outside the 60-day window).
  if (!order) {
    return { status: "ok", events: [], pageInfo: { ...EMPTY_PAGE_INFO }, error: null, details: null };
  }

  const nodes = order.events?.nodes || [];
  const pageInfo = order.events?.pageInfo || EMPTY_PAGE_INFO;

  return {
    status: "ok",
    events: nodes.map(normalizeEvent).filter(Boolean),
    pageInfo: {
      hasNextPage: pageInfo.hasNextPage === true,
      endCursor: pageInfo.endCursor || null,
    },
    error: null,
    details: null,
  };
}

/**
 * Fetch one page of a Shopify order's timeline events.
 * Returns a normalized sentinel object instead of throwing.
 */
async function fetchOrderEvents(options = {}) {
  const { tenant, orderId, limit, cursor } = options;
  const httpClient = options.httpClient || axios;

  if (!tenant?.shopDomain || !tenant?.accessToken) {
    return unavailableResult("unavailable", "Tenant is missing Shopify credentials.");
  }
  if (!orderId) {
    return unavailableResult("unavailable", "orderId is required.");
  }

  const url = `https://${tenant.shopDomain}.myshopify.com/admin/api/${resolveApiVersion(
    tenant
  )}/graphql.json`;

  const variables = {
    id: toOrderGid(orderId),
    first: clampPageSize(limit),
    after: cursor || null,
  };

  try {
    const response = await httpClient.post(
      url,
      { query: buildEventsQuery(), variables },
      {
        headers: {
          "X-Shopify-Access-Token": tenant.accessToken,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );
    return normalizeOrderEvents(response?.data);
  } catch (err) {
    const httpStatus = err?.response?.status || null;
    if (httpStatus === 401 || httpStatus === 403) {
      return unavailableResult("forbidden", "Shopify denied access to this order's events.");
    }
    return unavailableResult(
      "unavailable",
      err?.message || "Failed to reach Shopify.",
      err?.response?.data?.errors || null
    );
  }
}

function redisCacheKey(tenantId, orderId, cursor, limit) {
  return `shopify:orderEvents:${tenantId || "platform"}:${orderId}:${cursor || "first"}:${limit}`;
}

async function loadCachedEvents(key) {
  try {
    const redis = require("../utils/redisClient");
    const cached = await redis.get(key);
    return cached ? JSON.parse(cached) : null;
  } catch (_) {
    return null;
  }
}

async function storeCachedEvents(key, result, ttlSeconds) {
  if (result.status !== "ok") return;
  try {
    const redis = require("../utils/redisClient");
    await redis.set(key, JSON.stringify(result), "EX", ttlSeconds);
  } catch (_) {
    // Redis is an optimization here; a cache failure must not fail the request.
  }
}

/**
 * Cached wrapper around fetchOrderEvents. Only successful pages are cached.
 */
async function getOrderEvents(options = {}) {
  const {
    tenant,
    orderId,
    limit,
    cursor,
    httpClient,
    useRedisCache = false,
    cacheTtlSeconds = Number(process.env.SHOPIFY_TIMELINE_CACHE_TTL_SECONDS) ||
      DEFAULT_CACHE_TTL_SECONDS,
  } = options;

  const pageSize = clampPageSize(limit);
  const key = redisCacheKey(tenant?._id, orderId, cursor, pageSize);

  if (useRedisCache) {
    const cached = await loadCachedEvents(key);
    if (cached) return cached;
  }

  const result = await fetchOrderEvents({ tenant, orderId, limit: pageSize, cursor, httpClient });

  if (useRedisCache) {
    const ttl =
      Number.isFinite(cacheTtlSeconds) && cacheTtlSeconds > 0
        ? cacheTtlSeconds
        : DEFAULT_CACHE_TTL_SECONDS;
    await storeCachedEvents(key, result, ttl);
  }

  return result;
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  buildEventsQuery,
  normalizeOrderEvents,
  fetchOrderEvents,
  getOrderEvents,
  clampPageSize,
  toOrderGid,
};
