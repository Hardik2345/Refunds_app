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

// Same idiom as refundsController.js — the client works with numeric ids.
function toNumericId(gid) {
  const raw = String(gid || "");
  const match = raw.match(/\/(\d+)$/);
  return match ? Number(match[1]) : raw || null;
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

// Shared by both documents below so a field added here shows up on the first
// page and on every "Load more" page.
const EVENT_NODE_FIELDS = `
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
    hasAdditionalContent
    additionalContent
  }
  ... on CommentEvent {
    rawMessage
    author { name email }
  }
`;

// Shopify resizes on its CDN, so a 160px thumbnail costs us nothing extra.
const THUMBNAIL_TRANSFORM = "transform: {maxWidth: 160, maxHeight: 160, preferredContentType: WEBP}";

const MONEY_FIELDS = "presentmentMoney { amount currencyCode }";

const MAX_LINE_ITEMS = 50;

function buildEventsQuery() {
  return `
    query OrderTimeline($id: ID!, $first: Int!, $after: String) {
      order(id: $id) {
        id
        events(first: $first, after: $after, reverse: true) {
          pageInfo { hasNextPage endCursor }
          nodes { ${EVENT_NODE_FIELDS} }
        }
      }
    }
  `;
}

/**
 * Order header + line items (with CDN-resized thumbnails) + the first page of
 * events, in a single request. GraphQL nesting is what keeps this to one
 * roundtrip — no separate product lookup for the images.
 */
function buildOrderDetailQuery() {
  return `
    query OrderDetail($id: ID!, $first: Int!) {
      order(id: $id) {
        id
        name
        createdAt
        cancelledAt
        displayFinancialStatus
        displayFulfillmentStatus
        currencyCode
        note
        tags
        subtotalPriceSet { ${MONEY_FIELDS} }
        totalShippingPriceSet { ${MONEY_FIELDS} }
        totalTaxSet { ${MONEY_FIELDS} }
        totalPriceSet { ${MONEY_FIELDS} }
        totalRefundedSet { ${MONEY_FIELDS} }
        shippingLine {
          title
          discountedPriceSet { ${MONEY_FIELDS} }
        }
        lineItems(first: ${MAX_LINE_ITEMS}) {
          pageInfo { hasNextPage }
          nodes {
            id
            name
            title
            variantTitle
            sku
            quantity
            currentQuantity
            refundableQuantity
            originalUnitPriceSet { ${MONEY_FIELDS} }
            discountedUnitPriceSet { ${MONEY_FIELDS} }
            discountedTotalSet { ${MONEY_FIELDS} }
            image { url(${THUMBNAIL_TRANSFORM}) altText }
            product {
              featuredMedia {
                preview { image { url(${THUMBNAIL_TRANSFORM}) altText } }
              }
            }
          }
        }
        events(first: $first, reverse: true) {
          pageInfo { hasNextPage endCursor }
          nodes { ${EVENT_NODE_FIELDS} }
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

/**
 * `additionalContent` is a loosely-typed JSON scalar with no documented shape —
 * it powers the collapsible detail on events like "captured ₹600.00 on Gokwik
 * Upi". Flatten best-effort and drop anything that isn't text.
 */
function normalizeAdditionalContent(content) {
  if (!content) return [];

  const lines = [];
  const push = (value) => {
    const text = toPlainText(value);
    if (text) lines.push(text);
  };

  const visit = (value) => {
    if (typeof value === "string") return push(value);
    if (typeof value === "number" || typeof value === "boolean") return push(String(value));
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === "object") {
      // {label, value} pairs render as "Label: value"; anything else is walked.
      const label = toPlainText(value.label || value.title || value.name);
      const inner = value.value ?? value.text ?? value.content ?? value.message;
      if (label && (typeof inner === "string" || typeof inner === "number")) {
        return push(`${label}: ${inner}`);
      }
      if (label && inner === undefined) return push(label);
      return Object.values(value).forEach(visit);
    }
  };

  visit(content);
  return lines;
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
    detailLines: node.hasAdditionalContent
      ? normalizeAdditionalContent(node.additionalContent)
      : [],
  };
}

// Shopify reports a missing read_all_orders grant as a GraphQL error, not a 403.
function classifyGraphqlErrors(payload) {
  if (!payload?.errors?.length) return null;
  const messages = payload.errors.map((e) => e?.message).filter(Boolean);
  const denied = messages.some((m) => /access denied|not approved|read_all_orders/i.test(m));
  return {
    status: denied ? "forbidden" : "unavailable",
    error: messages[0] || "Shopify returned GraphQL errors.",
    details: payload.errors,
  };
}

/**
 * Pure normalizer for an Admin GraphQL OrderTimeline response body.
 * Never throws — an unusable payload becomes an `unavailable` sentinel.
 */
function normalizeOrderEvents(payload) {
  const failure = classifyGraphqlErrors(payload);
  if (failure) return unavailableResult(failure.status, failure.error, failure.details);

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

// Presentment money throughout, matching refundsController.js.
function moneyOf(moneySet) {
  const money = moneySet?.presentmentMoney;
  if (!money || money.amount == null) return null;
  return { amount: String(money.amount), currencyCode: money.currencyCode || null };
}

function normalizeLineItem(node) {
  if (!node) return null;
  // LineItem.image is the variant's image and is null for deleted products and
  // for imported line items with no variant; fall back to the product's
  // featured media before giving up and letting the UI show a placeholder.
  const image = node.image || node.product?.featuredMedia?.preview?.image || null;
  const quantity = Number(node.quantity) || 0;

  return {
    id: toNumericId(node.id),
    name: node.name || node.title || null,
    title: node.title || null,
    variantTitle: node.variantTitle || null,
    sku: node.sku || null,
    quantity,
    currentQuantity: Number.isFinite(Number(node.currentQuantity))
      ? Number(node.currentQuantity)
      : quantity,
    refundableQuantity: Number.isFinite(Number(node.refundableQuantity))
      ? Number(node.refundableQuantity)
      : quantity,
    unitPrice: moneyOf(node.discountedUnitPriceSet) || moneyOf(node.originalUnitPriceSet),
    lineTotal: moneyOf(node.discountedTotalSet),
    imageUrl: image?.url || null,
    imageAlt: image?.altText || null,
  };
}

function normalizeOrderSummaryNode(order) {
  if (!order) return null;
  const shippingLine = order.shippingLine || null;

  return {
    id: toNumericId(order.id),
    name: order.name || null,
    createdAt: order.createdAt || null,
    cancelledAt: order.cancelledAt || null,
    financialStatus: order.displayFinancialStatus
      ? String(order.displayFinancialStatus).toLowerCase()
      : null,
    fulfillmentStatus: order.displayFulfillmentStatus
      ? String(order.displayFulfillmentStatus).toLowerCase()
      : null,
    currencyCode: order.currencyCode || null,
    note: order.note || null,
    tags: Array.isArray(order.tags) ? order.tags : [],
    shipping: shippingLine
      ? { title: shippingLine.title || null, price: moneyOf(shippingLine.discountedPriceSet) }
      : null,
    totals: {
      subtotal: moneyOf(order.subtotalPriceSet),
      shipping: moneyOf(order.totalShippingPriceSet),
      tax: moneyOf(order.totalTaxSet),
      total: moneyOf(order.totalPriceSet),
      refunded: moneyOf(order.totalRefundedSet),
    },
  };
}

function emptyDetailResult(status, error, details) {
  return {
    status,
    order: null,
    lineItems: [],
    hasMoreLineItems: false,
    events: [],
    pageInfo: { ...EMPTY_PAGE_INFO },
    error: error || null,
    details: details || null,
  };
}

/**
 * Pure normalizer for an Admin GraphQL OrderDetail response body — header,
 * line items and the first page of events. Never throws.
 */
function normalizeOrderDetail(payload) {
  const failure = classifyGraphqlErrors(payload);
  if (failure) return emptyDetailResult(failure.status, failure.error, failure.details);

  const order = payload?.data?.order;
  // A null order means it does not exist, or this token cannot see it.
  if (!order) return emptyDetailResult("ok");

  const eventNodes = order.events?.nodes || [];
  const eventPageInfo = order.events?.pageInfo || EMPTY_PAGE_INFO;

  return {
    status: "ok",
    order: normalizeOrderSummaryNode(order),
    lineItems: (order.lineItems?.nodes || []).map(normalizeLineItem).filter(Boolean),
    hasMoreLineItems: order.lineItems?.pageInfo?.hasNextPage === true,
    events: eventNodes.map(normalizeEvent).filter(Boolean),
    pageInfo: {
      hasNextPage: eventPageInfo.hasNextPage === true,
      endCursor: eventPageInfo.endCursor || null,
    },
    error: null,
    details: null,
  };
}

/**
 * POSTs one Admin GraphQL document. Returns `{ ok: true, data }` or a failure
 * descriptor the callers turn into their own sentinel shape — never throws.
 */
async function postGraphql(options) {
  const { tenant, orderId, query, variables } = options;
  const httpClient = options.httpClient || axios;

  if (!tenant?.shopDomain || !tenant?.accessToken) {
    return { ok: false, status: "unavailable", error: "Tenant is missing Shopify credentials." };
  }
  if (!orderId) {
    return { ok: false, status: "unavailable", error: "orderId is required." };
  }

  const url = `https://${tenant.shopDomain}.myshopify.com/admin/api/${resolveApiVersion(
    tenant
  )}/graphql.json`;

  try {
    const response = await httpClient.post(
      url,
      { query, variables },
      {
        headers: {
          "X-Shopify-Access-Token": tenant.accessToken,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );
    return { ok: true, data: response?.data };
  } catch (err) {
    const httpStatus = err?.response?.status || null;
    if (httpStatus === 401 || httpStatus === 403) {
      return { ok: false, status: "forbidden", error: "Shopify denied access to this order." };
    }
    return {
      ok: false,
      status: "unavailable",
      error: err?.message || "Failed to reach Shopify.",
      details: err?.response?.data?.errors || null,
    };
  }
}

/**
 * Fetch one page of a Shopify order's timeline events.
 * Returns a normalized sentinel object instead of throwing.
 */
async function fetchOrderEvents(options = {}) {
  const { tenant, orderId, limit, cursor, httpClient } = options;

  const outcome = await postGraphql({
    tenant,
    orderId,
    httpClient,
    query: buildEventsQuery(),
    variables: {
      id: toOrderGid(orderId),
      first: clampPageSize(limit),
      after: cursor || null,
    },
  });

  if (!outcome.ok) return unavailableResult(outcome.status, outcome.error, outcome.details);
  return normalizeOrderEvents(outcome.data);
}

/**
 * Fetch the order header, its line items (thumbnails included) and the first
 * page of events in a single Shopify request.
 */
async function fetchOrderDetail(options = {}) {
  const { tenant, orderId, limit, httpClient } = options;

  const outcome = await postGraphql({
    tenant,
    orderId,
    httpClient,
    query: buildOrderDetailQuery(),
    variables: {
      id: toOrderGid(orderId),
      first: clampPageSize(limit),
    },
  });

  if (!outcome.ok) return emptyDetailResult(outcome.status, outcome.error, outcome.details);
  return normalizeOrderDetail(outcome.data);
}

function redisCacheKey(prefix, tenantId, orderId, cursor, limit) {
  return `${prefix}:${tenantId || "platform"}:${orderId}:${cursor || "first"}:${limit}`;
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

function resolveCacheTtl(cacheTtlSeconds) {
  const ttl =
    cacheTtlSeconds === undefined
      ? Number(process.env.SHOPIFY_TIMELINE_CACHE_TTL_SECONDS)
      : Number(cacheTtlSeconds);
  return Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_CACHE_TTL_SECONDS;
}

/**
 * Cached wrapper around a fetcher. Only successful results are cached, and a
 * Redis failure can never fail the request.
 */
async function withRedisCache(key, useRedisCache, cacheTtlSeconds, fetcher) {
  if (useRedisCache) {
    const cached = await loadCachedEvents(key);
    if (cached) return cached;
  }

  const result = await fetcher();

  if (useRedisCache) {
    await storeCachedEvents(key, result, resolveCacheTtl(cacheTtlSeconds));
  }

  return result;
}

/**
 * Cached wrapper around fetchOrderEvents — the "Load more" path.
 */
async function getOrderEvents(options = {}) {
  const { tenant, orderId, limit, cursor, httpClient, useRedisCache = false, cacheTtlSeconds } =
    options;

  const pageSize = clampPageSize(limit);
  const key = redisCacheKey("shopify:orderEvents", tenant?._id, orderId, cursor, pageSize);

  return withRedisCache(key, useRedisCache, cacheTtlSeconds, () =>
    fetchOrderEvents({ tenant, orderId, limit: pageSize, cursor, httpClient })
  );
}

/**
 * Cached wrapper around fetchOrderDetail — the first-open path. Distinct key
 * prefix so a warm events-only cache can never be served as a detail payload.
 */
async function getOrderDetail(options = {}) {
  const { tenant, orderId, limit, httpClient, useRedisCache = false, cacheTtlSeconds } = options;

  const pageSize = clampPageSize(limit);
  const key = redisCacheKey("shopify:orderDetail", tenant?._id, orderId, null, pageSize);

  return withRedisCache(key, useRedisCache, cacheTtlSeconds, () =>
    fetchOrderDetail({ tenant, orderId, limit: pageSize, httpClient })
  );
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_LINE_ITEMS,
  buildEventsQuery,
  buildOrderDetailQuery,
  normalizeOrderEvents,
  normalizeOrderDetail,
  normalizeAdditionalContent,
  fetchOrderEvents,
  fetchOrderDetail,
  getOrderEvents,
  getOrderDetail,
  clampPageSize,
  toOrderGid,
};
