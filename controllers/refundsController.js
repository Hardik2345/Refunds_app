const axios = require("axios");
const PendingRefund = require("../models/pendingRefundModel");
const RefundStat=require("../models/refundStatModel");
const redis = require("../utils/redisClient");
require("@shopify/shopify-api/adapters/node");
const { shopifyApi, LATEST_API_VERSION } = require("@shopify/shopify-api");
const { buildRefundContext, evaluateRefundRules } = require("../middlewares/rules");
const { appendOrderTags } = require("../utils/appendOrderTags");

// 🔹 Utility: Parse Shopify link headers for pagination
const parseLinkHeader = (linkHeader) => {
  if (!linkHeader) return { next: null };
  const links = linkHeader.split(", ");
  const nextLink = links.find((link) => link.includes('rel="next"'));
  if (!nextLink) return { next: null };
  const match = nextLink.match(/page_info=([^>]+)/);
  return { next: match ? match[1] : null };
};

// 🔹 Utility: Fetch order transactions
const getOrderTransactions = async (tenant, orderId) => {
  const url = `https://${tenant.shopDomain}.myshopify.com/admin/api/${tenant.apiVersion}/orders/${orderId}/transactions.json`;
  const response = await axios.get(url, {
    headers: { "X-Shopify-Access-Token": tenant.accessToken },
  });
  return response.data.transactions;
};

// 🔹 Utility: Check if order already has refunds
async function hasRefunds(tenant, orderId) {
  try {
    const client = new (shopifyApi({
      apiKey: tenant.apiKey,
      apiSecretKey: tenant.apiSecret,
      scopes: ["read_orders", "write_orders"],
      hostName: tenant.shopDomain,
      apiVersion: tenant.apiVersion || LATEST_API_VERSION,
    })).clients.Rest({
      session: { shop: `${tenant.shopDomain}.myshopify.com`, accessToken: `${tenant.accessToken}` },
    });

    const response = await client.get({ path: `orders/${orderId}/refunds.json` });
    const refunds = response.body.refunds || [];
    return refunds.some((refund) => refund.transactions && refund.transactions.length > 0);
  } catch (err) {
    console.error(`Refund check failed for ${orderId}:`, err.message);
    return true; // safer default
  }
}

function runMw(req, res, mw) {
  return new Promise((resolve, reject) => {
    try {
      mw(req, res, (err) => (err ? reject(err) : resolve()));
    } catch (e) {
      reject(e);
    }
  });
}

function inferErrorCode(err) {
  const msg = (err && (err.code || err.name || err.message || "")).toString().toUpperCase();
  if (msg.includes("RATE") || msg.includes("429")) return "RATE_LIMIT";
  if (msg.includes("ECONN") || msg.includes("TIMEDOUT") || msg.includes("TIMEOUT")) return "NETWORK";
  if (msg.includes("403")) return "POLICY_DENIED";
  if (msg.includes("5") && msg.includes("SHOPIFY")) return "SHOPIFY_5XX";
  return "UNKNOWN";
}


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Tiny memo helper (placeholder, can be extended later)
function makeMemo() {
  const store = new Map();
  return {
    get: (k) => store.get(k),
    set: (k, v) => { store.set(k, v); return v; },
    has: (k) => store.has(k),
  };
}

// Concurrency mapper with retries
async function mapWithConcurrency(items, limit, mapper, maxRetries = 3) {
  const results = new Array(items.length);
  let idxCounter = 0;

  async function worker() {
    while (true) {
      const idx = idxCounter++;
      if (idx >= items.length) break;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          results[idx] = await mapper(items[idx], idx);
          break;
        } catch (err) {
          if (attempt === maxRetries) {
            results[idx] = err;
          } else {
            await sleep(100 * 2 ** (attempt - 1));
          }
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

exports.mapWithConcurrency = mapWithConcurrency;

// 🔹 Utility: Get orders for a customer by phone
async function getOrdersByPhone(tenant, phone) {
  const customerSearchUrl = `https://${tenant.shopDomain}.myshopify.com/admin/api/${tenant.apiVersion}/customers/search.json`;
  const customerResponse = await axios.get(customerSearchUrl, {
    params:{query:`phone:${phone}`},
    headers: { "X-Shopify-Access-Token": tenant.accessToken },
  });

  if (!customerResponse.data.customers.length) return null;
  const customerId = customerResponse.data.customers[0].id;

  const ordersUrl = `https://${tenant.shopDomain}.myshopify.com/admin/api/${tenant.apiVersion}/orders.json?customer_id=${customerId}&status=any&limit=5`;
  const ordersResponse = await axios.get(ordersUrl, {
    headers: { "X-Shopify-Access-Token": tenant.accessToken },
  });

  return ordersResponse.data.orders;
}

// 🔹 Controller: Get Orders
exports.getOrders = async (req, res) => {
  const { startDate, endDate, limit = 10, page_info, phone } = req.query;

  try {
    const tenant = req.tenant; // ✅ injected by middleware
    let requestUrl;

    if (phone) {
      // Find customer by phone
      const customerSearchUrl = `https://${tenant.shopDomain}.myshopify.com/admin/api/${tenant.apiVersion}/customers/search.json`;
      const customerResponse = await axios.get(customerSearchUrl, {
        params:{query:`phone:${phone}`},
        headers: { "X-Shopify-Access-Token": tenant.accessToken },
      });

      if (!customerResponse.data.customers.length) {
        return res.status(404).json({ error: "No customer found with this phone number." });
      }
      const customerId = customerResponse.data.customers[0].id;

      let queryParams = new URLSearchParams({ limit, status: "any", customer_id: customerId });
      if (page_info) queryParams.append("page_info", page_info);
      requestUrl = `https://${tenant.shopDomain}.myshopify.com/admin/api/${tenant.apiVersion}/orders.json?${queryParams.toString()}`;
    } else if (startDate && endDate) {
      // Filter by date
      let queryParams = new URLSearchParams({
        limit,
        status: "any",
        created_at_min: startDate,
        created_at_max: endDate,
      });
      if (page_info) queryParams.append("page_info", page_info);
      requestUrl = `https://${tenant.shopDomain}.myshopify.com/admin/api/${tenant.apiVersion}/orders.json?${queryParams.toString()}`;
    } else {
      return res.status(400).json({ error: "Please provide either a phone number or a date range." });
    }

    const response = await axios.get(requestUrl, {
      headers: { "X-Shopify-Access-Token": tenant.accessToken },
    });

    const pageInfo = parseLinkHeader(response.headers.link);

    const filteredOrders = response.data.orders.map((order) => ({
      id: order.id,
      name: order.name,
      created_at: order.created_at,
      current_subtotal_price: order.current_total_price,
      financial_status: order.financial_status,
      fulfillment_status: order.fulfillment_status,
      line_items: order.line_items.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        // Price after subtracting discount allocations for this line item
        price: (() => {
          const base = parseFloat(item.price) || 0;
          const disc = Array.isArray(item.discount_allocations)
            ? item.discount_allocations.reduce((sum, da) => sum + (parseFloat(da?.amount) || 0), 0)
            : 0;
          const net = Math.max(0, base - disc);
          return net.toFixed(2);
        })(),
      })),
      customer: order.customer
        ? {
            id: order.customer.id,
            first_name: order.customer.first_name,
            last_name: order.customer.last_name,
            email: order.customer.email,
            phone: order.customer.phone,
          }
        : null,
    }));

    res.status(200).json({ orders: filteredOrders, nextPageInfo: pageInfo.next });
  } catch (err) {
    console.error("Error fetching orders:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// 🔹 Controller: Refund Order by Phone
exports.refundOrderByPhone = async (req, res) => {
  try {
    if (res.locals.ruleDecision?.outcome === "REQUIRE_APPROVAL" && res.locals.requiresApproval) {
      const pending = await PendingRefund.create({
        tenant: req.tenant._id,
        requester: req.user._id,
        payload: {
          phone: req.body.phone || null,
          orderId: req.body.orderId || null,
          amount: Number(req.body.amount)
        },
        ruleDecision: res.locals.ruleDecision,
        context: req.ruleContext // optional, useful for review UI
      });

      return res.status(202).json({
        message: "Approval required. Request recorded.",
        pendingId: pending._id.toString(),
        ruleDecision: res.locals.ruleDecision
      });
    }
    const tenant = req.tenant; // ✅ injected by middleware
    const { phone, orderId, lineItems } = req.body;

    const orders = await getOrdersByPhone(tenant, phone);
    if (!orders || orders.length === 0)
      return res.status(404).json({ error: "No orders found for this phone number." });

    const targetOrder = orderId
      ? orders.find((o) => String(o.id) === String(orderId))
      : orders[0];

    if (!targetOrder) return res.status(404).json({ error: "Order not found for this customer." });

    const alreadyRefunded = await hasRefunds(tenant, targetOrder.id);
    if (alreadyRefunded) return res.status(400).json({ error: "This order has already been refunded." });

    const transactions = await getOrderTransactions(tenant, targetOrder.id);
    const successfulTransaction = transactions.find((t) => t.status === "success");
    if (!successfulTransaction)
      return res.status(400).json({ error: "No successful transaction found for this order." });

    const client = new (shopifyApi({
      apiKey: tenant.apiKey,
      apiSecretKey: tenant.apiSecret,
      scopes: ["read_orders", "write_orders"],
      hostName: tenant.shopDomain,
      apiVersion: tenant.apiVersion || LATEST_API_VERSION,
    })).clients.Rest({
      session: { shop: `${tenant.shopDomain}.myshopify.com`, accessToken: tenant.accessToken },
    });

    let refundPayload;

    if (lineItems && lineItems.length > 0) {
      // Partial refund
      refundPayload = {
        refund: {
          refund_line_items: lineItems.map((item) => ({
            line_item_id: item.lineItemId,
            quantity: 0,
            restock_type: "no_restock",
            location_id: 104836956455,
          })),
          transactions: [
            {
              parent_id: successfulTransaction.id,
              amount: lineItems
                .reduce((sum, item) => sum + parseFloat(item.amount || 0), 0)
                .toFixed(2),
              kind: "refund",
              gateway: successfulTransaction.gateway,
            },
          ],
          order_id: targetOrder.id,
          note: "Partial refund via REST API",
          notify: true,
        },
      };
      console.log("Partial refund payload:", JSON.stringify(refundPayload, null, 2));
    } else {
      // Full refund (with cancellation)
      try {
        await client.post({
          path: `orders/${targetOrder.id}/cancel`,
          data: { email: true, reason: "customer" },
          type: "application/json",
        });
      } catch (cancelErr) {
        console.error("Order cancellation failed:", cancelErr.message);
        return res.status(500).json({ error: "Order cancellation failed. Refund not processed." });
      }

      refundPayload = {
        refund: {
          transactions: [
            {
              parent_id: successfulTransaction.id,
              amount: targetOrder.total_price,
              kind: "refund",
              gateway: successfulTransaction.gateway,
            },
          ],
          shipping: { full_refund: true },
          order_id: targetOrder.id,
          note: "Full refund via REST API after cancellation",
          notify: true,
        },
      };
    }

    const response = await client.post({
      path: `orders/${targetOrder.id}/refunds`,
      data: refundPayload,
      type: "application/json",
    });

    // After successful refund, append informative tags to the order (best-effort)
    try {
      const tags = [
        'refunded_via_portal',
        `refunded_by:${req.user?.name || req.user?.email || req.user?._id || 'unknown'}`,
        `${Array.isArray(lineItems) && lineItems.length > 0 ? 'partial' : 'full'}`
      ];
      await appendOrderTags({
        shopDomain: req.tenant.shopDomain,
        accessToken: req.tenant.accessToken,
        orderId: targetOrder.id,
        tagsToAdd: tags,
        overwrite: false
      });
    } catch (e) {
      console.warn('appendOrderTags failed (non-fatal):', e.message);
    }

    // --- Lifetime refund COUNT ledger (per tenant x customer) ---
    try {
      // prefer the key computed in buildRefundContext (stable & reusable)
      let customerKey = req?.ruleContext?.meta?.customerKey || null;
      if (!customerKey) {
        const phone = req.body?.phone || targetOrder?.customer?.phone || targetOrder?.phone;
        const email = targetOrder?.customer?.email;
        customerKey = phone ? `phone:${String(phone)}` : (email ? `email:${String(email).toLowerCase()}` : null);
      }

      // optional: idempotency guard (avoid double-increment on retries)
      const refundId = response?.body?.refund?.id || response?.body?.refund?.admin_graphql_api_id || null;
      let canIncrement = true;
      if (redis && refundId) {
        const key = `refund_stat:incr_guard:${String(refundId)}`;
        // NX = only set if not exists; EX=expire. If returns 'OK', we own it.
        const setOk = await redis.set(key, "1", "NX", "EX", 300);
        canIncrement = !!setOk;
      }

      if (customerKey && canIncrement) {
        // on successful refund
        await RefundStat.updateOne(
          { tenant: req.tenant._id, customer: customerKey, user: req.user._id },
          {
            $inc: { totalCount: 1, successCount: 1 },
            $set: {
              lastRefundAt: new Date(),
              lastIp: req.ip || null,
              lastOutcome: "SUCCESS",
              lastErrorCode: null,
              lastErrorMsg: null,
              lastOrderId: String(targetOrder.id),
              lastAmount: Number(lineItems?.length
                ? lineItems.reduce((s,i)=>s+Number(i.amount||0),0)
                : targetOrder.total_price),
              lastPartial: Array.isArray(lineItems) && lineItems.length > 0,
              lastRuleSetId: res.locals?.ruleDecision?.ruleSetId || req.ruleContext?.ruleSetId || null,
              lastRulesVer: res.locals?.ruleDecision?.rulesVersion || req.ruleContext?.rulesVersion || null,
              retryCount: 0,
              nextRetryAt: null,
              lastRefundId: response?.body?.refund?.id || null,
            },
            $push: {
              attempts: {
                $each: [{
                  at: new Date(),
                  action: "refund",
                  outcome: "SUCCESS",
                  httpCode: 200,
                  errorCode: null,
                  errorMsg: null,
                  attemptNo: (/* you can pass from state if retried */ 1),
                  backoffMs: 0,
                  orderId: String(targetOrder.id),
                  amount: Number(lineItems?.length
                    ? lineItems.reduce((s,i)=>s+Number(i.amount||0),0)
                    : targetOrder.total_price),
                  partial: Array.isArray(lineItems) && lineItems.length > 0,
                  ruleSetId: res.locals?.ruleDecision?.ruleSetId || req.ruleContext?.ruleSetId || null,
                  rulesVer: res.locals?.ruleDecision?.rulesVersion || req.ruleContext?.rulesVersion || null,
                }],
                $slice: -25    // keep only the last 25 entries
              }
            }
          },
          { upsert: true }
        );

      }
    } catch (e) {
      console.error("RefundStat update failed:", e.message);
      // inside catch(err) when refund execution fails:
      try {
        const doc = await RefundStat.findOneAndUpdate(
          { tenant: req.tenant._id, customer: customerKey, user: req.user._id },
          { $setOnInsert: { retryBaseMs: 250, maxRetryMs: 30_000 } },
          { upsert: true, new: true }
        );

        // increment and compute next backoff
        doc.failureCount = (doc.failureCount || 0) + 1;
        doc.retryCount   = (doc.retryCount   || 0) + 1;
        const backoffMs = doc.computeBackoffMs();
        doc.nextRetryAt = new Date(Date.now() + backoffMs);
        doc.lastOutcome = "ERROR";
        doc.lastErrorCode = inferErrorCode(err);  // implement a tiny mapping
        doc.lastErrorMsg  = String(err.message || "unknown").slice(0, 500);
        doc.lastAttemptAt = new Date();

        doc.pushAttempt({
          action: "refund",
          outcome: "ERROR",
          httpCode: Number(err.status || err.statusCode) || null,
          errorCode: doc.lastErrorCode,
          errorMsg: doc.lastErrorMsg,
          attemptNo: doc.retryCount,
          backoffMs,
          orderId: req.body?.orderId || null,
          amount: Number(req.body?.amount) || null,
          partial: Array.isArray(req.body?.lineItems) && req.body.lineItems.length > 0,
          ruleSetId: req.ruleContext?.ruleSetId || null,
          rulesVer: req.ruleContext?.rulesVersion || null,
        });

        await doc.save();
      } catch (e) {
        console.error("RefundStat failure logging failed:", e.message);
      }

    }

    return res.status(200).json({ refund: response?.body?.refund || null });
  } catch (err) {
    console.error("Refund failed:", err.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.approvePendingRefund = async (req, res) => {
  try {
    const { pendingId } = req.params;
    const tenant = req.tenant;

    const pending = await PendingRefund.findOne({
      _id: pendingId,
      tenant: tenant._id,
      status: 'pending'
    });
    if (!pending) {
      return res.status(404).json({ error: 'Pending refund not found or not pending' });
    }

    const { phone, orderId, lineItems } = pending.payload;

    // --- Fetch target order again (fresh check) ---
    const orders = await getOrdersByPhone(tenant, phone);
    if (!orders || orders.length === 0) {
      return res.status(404).json({ error: 'No orders found for this phone number.' });
    }
    const targetOrder = orderId
      ? orders.find(o => String(o.id) === String(orderId))
      : orders[0];
    if (!targetOrder) {
      return res.status(404).json({ error: 'Order not found for this customer.' });
    }

    // --- Standard refund execution (same as refundOrderByPhone) ---
    const alreadyRefunded = await hasRefunds(tenant, targetOrder.id);
    if (alreadyRefunded) {
      return res.status(400).json({ error: 'This order has already been refunded.' });
    }

    const transactions = await getOrderTransactions(tenant, targetOrder.id);
    const successfulTransaction = transactions.find(t => t.status === 'success');
    if (!successfulTransaction) {
      return res.status(400).json({ error: 'No successful transaction found for this order.' });
    }

    const client = new (shopifyApi({
      apiKey: tenant.apiKey,
      apiSecretKey: tenant.apiSecret,
      scopes: ['read_orders', 'write_orders'],
      hostName: tenant.shopDomain,
      apiVersion: tenant.apiVersion || LATEST_API_VERSION,
    })).clients.Rest({
      session: { shop: tenant.shopDomain, accessToken: tenant.accessToken },
    });

    let refundPayload;
    if (lineItems && lineItems.length > 0) {
      refundPayload = {
        refund: {
          refund_line_items: lineItems.map(item => ({
            line_item_id: item.lineItemId,
            quantity: item.quantity,
            restock_type: item.restock_type || 'return',
            location_id: item.locationId || null,
          })),
          transactions: [
            {
              parent_id: successfulTransaction.id,
              amount: lineItems.reduce((sum, i) => sum + parseFloat(i.amount || 0), 0).toFixed(2),
              kind: 'refund',
              gateway: successfulTransaction.gateway,
            },
          ],
          order_id: targetOrder.id,
          note: 'Partial refund approved by supervisor',
          notify: true,
        },
      };
    } else {
      // Full refund
      try {
        await client.post({
          path: `orders/${targetOrder.id}/cancel`,
          data: { email: true, reason: 'customer' },
          type: 'application/json',
        });
      } catch (cancelErr) {
        console.error('Order cancellation failed:', cancelErr.message);
        return res.status(500).json({ error: 'Order cancellation failed. Refund not processed.' });
      }

      refundPayload = {
        refund: {
          transactions: [
            {
              parent_id: successfulTransaction.id,
              amount: targetOrder.total_price,
              kind: 'refund',
              gateway: successfulTransaction.gateway,
            },
          ],
          shipping: { full_refund: true },
          order_id: targetOrder.id,
          note: 'Full refund approved by supervisor',
          notify: true,
        },
      };
    }

    const response = await client.post({
      path: `orders/${targetOrder.id}/refunds`,
      data: refundPayload,
      type: 'application/json',
    });

    // Append tags on successful approved refund (best-effort)
    try {
      const tags = [
        'refunded_via_portal',
        'approved_by_supervisor',
        `refunded_by:${req.user?.name || req.user?.email || req.user?._id || 'unknown'}`,
        `${Array.isArray(lineItems) && lineItems.length > 0 ? 'partial' : 'full'}`
      ];
      await appendOrderTags({
        shopDomain: req.tenant.shopDomain,
        accessToken: req.tenant.accessToken,
        orderId: targetOrder.id,
        tagsToAdd: tags,
        overwrite: false
      });
    } catch (e) {
      console.warn('appendOrderTags failed (non-fatal):', e.message);
    }

  // --- Mark pending as approved ---
    pending.status = 'approved';
    pending.approvedBy = req.user._id;
    pending.approvedAt = new Date();
    await pending.save();

    // --- Update RefundStat on approved path as well ---
    try {
      let customerKey = req?.ruleContext?.meta?.customerKey || null;
      if (!customerKey) {
        const phone = pending?.payload?.phone || targetOrder?.customer?.phone || targetOrder?.phone;
        const email = targetOrder?.customer?.email;
        customerKey = phone ? `phone:${String(phone)}` : (email ? `email:${String(email).toLowerCase()}` : null);
      }
      if (customerKey) {
        await RefundStat.updateOne(
          { tenant: req.tenant._id, customer: customerKey, user: req.user._id },
          { $inc: { totalCount: 1 }, $set: { lastRefundAt: new Date(), lastIp: req.ip || null } },
          { upsert: true }
        );
      }
    } catch (e) {
      console.error('RefundStat update (approve) failed:', e.message);
    }

    return res.status(200).json({
      message: 'Refund executed successfully',
      refund: response?.body?.refund || null,
      pendingId: pending._id.toString()
    });
  } catch (err) {
    console.error('approvePendingRefund failed:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

exports.denyPendingRefund = async (req, res) => {
  try {
    const { pendingId } = req.params;
    const tenant = req.tenant;

    const pending = await PendingRefund.findOne({
      _id: pendingId,
      tenant: tenant._id,
      status: 'pending'
    });
    if (!pending) {
      return res.status(404).json({ error: 'Pending refund not found or not pending' });
    }

    pending.status = 'denied';
    pending.deniedBy = req.user._id;
    pending.deniedAt = new Date();
    await pending.save();

    return res.status(200).json({
      message: 'Pending refund denied',
      pendingId: pending._id.toString()
    });
  } catch (err) {
    console.error('denyPendingRefund failed:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

exports.bulkPreviewRefunds = async (req, res) => {
  try {
    const tenant = req.tenant;
    const user = req.user;
    const defaultPhone = req.body?.phone || null;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!items.length) {
      return res.status(400).json({ error: "Provide items: [{ orderId, amount?, lineItems? }]" });
    }

    const memo = makeMemo(); // reserved for later caching if you want
    const CONCURRENCY = 4;   // 3–5 is usually safe for Shopify

    const results = await mapWithConcurrency(items, CONCURRENCY, async (item) => {
      const payload = {
        phone: item.phone || defaultPhone || null,
        orderId: item.orderId || null,
        amount: item.amount,
        lineItems: Array.isArray(item.lineItems) ? item.lineItems : []
      };

      // Fake req/res to reuse buildRefundContext
      const fakeReq = { ...req, tenant, user, body: payload, ruleContext: undefined, memo };
      const fakeRes = {
        statusCode: 200,
        headers: {},
        locals: {},
        status(code) { this.statusCode = code; return this; },
        setHeader(name, value) { this.headers[name] = value; },
        json(obj) { const e = new Error(obj?.error || "Context build failed"); e._payload = obj; throw e; }
      };

      // Execute the context builder (I/O overlaps across workers)
      await runMw(fakeReq, fakeRes, buildRefundContext);

      const decision = evaluateRefundRules(fakeReq.ruleContext);
      const requiresApproval =
        decision.outcome === "REQUIRE_APPROVAL" &&
        !((fakeReq.ruleContext.user?.roles || []).includes("super_admin"));

      const ctxHints = {
        orderId: fakeReq.ruleContext.order?.id || payload.orderId || null,
        rulesVersion: fakeReq.ruleContext.rulesVersion,
        ruleSetId: fakeReq.ruleContext.ruleSetId,
        attemptsToday: fakeReq.ruleContext.meta?.attemptsToday,
        daysSinceDelivery: fakeReq.ruleContext.meta?.daysSinceDelivery,
        totalCredits: fakeReq.ruleContext.meta?.totalCredits ?? null,
        totalSpentCredits: fakeReq.ruleContext.meta?.totalSpentCredits ?? null,
        totalSpentCreditsRaw: fakeReq.ruleContext.meta?.totalSpentCreditsRaw ?? null
      };

      return { orderId: ctxHints.orderId, decision, requiresApproval, ctxHints, error: null };
    });

    // Normalize errors captured by the mapper
    const normalized = results.map((r, idx) => {
      if (r instanceof Error) {
        return {
          orderId: items[idx]?.orderId || null,
          decision: null,
          requiresApproval: null,
          ctxHints: null,
          error: r.message || "Failed to preview"
        };
      }
      return r;
    });

    return res.status(200).json({ results: normalized });
  } catch (err) {
    console.error("[bulkPreviewRefunds] failed:", err.message);
    return res.status(500).json({ error: "Failed to preview refunds in bulk" });
  }
};