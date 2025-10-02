const axios = require("axios");
const redis = require("../utils/redisClient");

// ---- Model-backed rule loading ----
const RefundRules = require("../models/refundRulesModel");
const RefundStat = require("../models/refundStatModel");

// Optional JSON Schema validation (keeps Admin/UI and server in sync)
let validateRefundRules = null;

// ---- Tiny in-memory cache for active rulesets (per tenant) ----
const RULES_TTL_SEC = Number(60); // 60s is fine for dev; tune later
/**
 * Cache key: tenantId || 'platform'
 * Cache value: { expiresAt, payload: { rules, version, id } }
 */
async function loadActiveRules(tenantId) {
  const key = `refundRules:${tenantId || "platform"}`;

  // Check cache
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  // Fallback to DB
  const active = await RefundRules.getActiveForTenant(tenantId || null);
  const payload = active
    ? { rules: active.rules || { mode: "observe" }, version: active.version || 1, id: String(active._id) }
    : { rules: { mode: "observe" }, version: 0, id: null };

  // Cache in Redis
  await redis.set(key, JSON.stringify(payload), "EX", RULES_TTL_SEC);
  return payload;
}

function pickApiVersion(tenant) {
  return tenant.apiVersion || "2024-07";
}
function shopHeaders(tenant) {
  return { "X-Shopify-Access-Token": tenant.accessToken };
}

/**
 * buildRefundContext(req, res, next)
 * Resolves customer + order + refund history so rules have data.
 * Loads rules via RefundRules model (with platform fallback).
 */
async function buildRefundContext(req, res, next) {
  try {
    const tenant = req.tenant;
    if (!tenant) return res.status(500).json({ error: "Tenant not loaded" });

    const { phone, orderId, amount, lineItems } = req.body || {};
    if (!phone && !orderId) {
      return res.status(400).json({ error: "Provide phone or orderId for refund context" });
    }

    // ---- Load active ruleset from the model (with cache) ----
    const active = await loadActiveRules(tenant._id || tenant.id || null);
    const rules = active.rules || { mode: "observe" };
    const rulesVersion = active.version || 0;
    const ruleSetId = active.id || null;

    // Optional schema validation (safe in dev; remove if not needed)
    if (validateRefundRules) {
      const ok = validateRefundRules(rules);
      if (!ok) {
        return res.status(400).json({ error: "Invalid refundRules", details: validateRefundRules.errors });
      }
    }

    const apiVersion = pickApiVersion(tenant);
    const base = `https://${tenant.shopDomain}.myshopify.com/admin/api/${apiVersion}`;

    // Resolve customer by phone (if provided)
    let customerId = null;
    if (phone) {
      try {
        const url = `https://${tenant.shopDomain}.myshopify.com/admin/api/2024-07/customers/search.json`;
        const resp = await axios.get(url, {
          params: { query: `phone:${phone}` },
          headers: shopHeaders(tenant),
        });
        if (resp.data.customers?.length) {
          customerId = resp.data.customers[0].id;
        }
      } catch (_) {
        customerId = null; // best effort in dev
      }
    }

    // Resolve order (explicit or latest by customer)
    let order = null;
    if (orderId) {
      const url = `${base}/orders/${orderId}.json`;
      const r = await axios.get(url, { headers: shopHeaders(tenant) });
      order = r.data?.order || null;
      if (order && !customerId) customerId = order.customer?.id || null;
    } else if (customerId) {
      const url = `${base}/orders.json?customer_id=${customerId}&status=any&limit=1`;
      const r = await axios.get(url, { headers: shopHeaders(tenant) });
      order = (r.data.orders && r.data.orders[0]) || null;
    }

    // Order total & requested percent
    const orderTotal = order ? Number(order.total_price) : null;
    const requestedAmount = amount != null ? Number(amount) : null;
    const requestedPercent =
      orderTotal && requestedAmount ? (requestedAmount / orderTotal) * 100 : null;

    // Is the target order already refunded?
    let targetOrderAlreadyRefunded = false;
    if (order?.id) {
      const url = `${base}/orders/${order.id}/refunds.json`;
      try {
        const r = await axios.get(url, { headers: shopHeaders(tenant) });
        const refunds = r.data.refunds || [];
        targetOrderAlreadyRefunded = refunds.some(
          (ref) => ref.transactions && ref.transactions.length > 0
        );
      } catch {
        // safer default in dev if we can't tell
        targetOrderAlreadyRefunded = true;
      }
    }

    // How many refunds has this customer had today?
    let attemptsToday = 0;
    if (customerId) {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      try {
        const url = `${base}/orders.json?customer_id=${customerId}&status=any&created_at_min=${since.toISOString()}`;
        const or = await axios.get(url, { headers: shopHeaders(tenant) });
        const orders = or.data.orders || [];
        for (const o of orders) {
          const rurl = `${base}/orders/${o.id}/refunds.json`;
          const rr = await axios.get(rurl, { headers: shopHeaders(tenant) });
          const refunds = rr.data.refunds || [];
          attemptsToday += refunds.filter(
            (ref) => ref.transactions && ref.transactions.length > 0
          ).length;
        }
      } catch {
        // conservative in dev
        attemptsToday = Number.MAX_SAFE_INTEGER;
      }
    }

    let lifetimeRefundCount = 0;
    let customerKey = null;

    // derive a stable key (use phone for now; in prod, hash phone/email)
  if (req.body?.phone) customerKey = `phone:${String(req.body.phone)}`;
  else if (order?.customer?.email) customerKey = `email:${String(order.customer.email).toLowerCase()}`;

    if (customerKey) {
        const stat = await RefundStat.findOne({ tenant: req.tenant._id, customer: customerKey })
            .select({ totalCount: 1 })
            .lean();
        lifetimeRefundCount = stat?.totalCount || 0;
    }

    function resolveDeliveredAt(o) {
        if (!o) return null;
        const fulf = Array.isArray(o.fulfillments) ? o.fulfillments : [];
        const deliveredCandidates = [];
        for (const f of fulf) {
            if (f.delivered_at) deliveredCandidates.push(new Date(f.delivered_at).getTime());
            if (f.updated_at) deliveredCandidates.push(new Date(f.updated_at).getTime());
            if (f.created_at) deliveredCandidates.push(new Date(f.created_at).getTime());
        }
        if (deliveredCandidates.length) {
            return new Date(Math.max(...deliveredCandidates)).toISOString();
        }
        if (o.fulfilled_at) return new Date(o.fulfilled_at).toISOString();
        return null;
    }
    const deliveredAt = resolveDeliveredAt(order) || (order?.created_at ? new Date(order.created_at).toISOString() : null);
    const nowTs = Date.now();
    const deliveredTs = deliveredAt ? new Date(deliveredAt).getTime() : null;
    const daysSinceDelivery = deliveredTs ? Math.floor((nowTs - deliveredTs) / 86_400_000) : null;

    // Cashback credits (spent and total) via Flits API – optional and best-effort
    let totalSpentCreditsRaw = null;
    let totalSpentCredits = null;
    let totalCredits = null;
    if (customerId && process.env.FLITS_USER_ID && process.env.FLITS_API_KEY) {
      try {
        const url = `https://app.getflits.com/api/1/${process.env.FLITS_USER_ID}/${customerId}/credit/get_credit`;
        const r = await axios.get(url, { params: { token: process.env.FLITS_API_KEY } });
        const spent = Number(r?.data?.customer?.total_spent_credits ?? r?.data?.total_spent_credits);
        if (Number.isFinite(spent)) {
          totalSpentCreditsRaw = spent;
          totalSpentCredits = Math.abs(spent) / 100; // normalized display value
        }
        const credits = Number(r?.data?.customer?.credits);
        if (Number.isFinite(credits)) totalCredits = credits;
      } catch (_) {
        totalSpentCreditsRaw = null;
        totalSpentCredits = null; // skip if failed
        totalCredits = null;
      }
    }


    // Build context object for the evaluator
    req.ruleContext = {
      tenantId: String(tenant._id || tenant.id),
      ruleSetId,               // for audit
      rulesVersion,            // for audit / reproducibility
      rules,
      user: {
        id: req.user && req.user._id ? String(req.user._id) : null,
        roles: (req.user && req.user.roles) || [],
      },
      order: order
        ? {
            id: order.id,
            customerId,
            total: orderTotal,
            paymentMethod: (order.payment_gateway_names[0] || order.processing_method || "").toLowerCase(),
          }
        : null,
      refund: {
        requestedAmount,
        requestedPercent: requestedPercent != null ? Number(requestedPercent) : null,
      },
      meta: {
        attemptsToday,
        targetOrderAlreadyRefunded,
        deliveredAt,
        daysSinceDelivery,
        lifetimeRefundCount,
        customerKey,
        totalSpentCredits, // normalized (abs/100) for display
        totalSpentCreditsRaw, // raw units from Flits (e.g., paise)
        totalCredits: Math.abs(totalCredits)/100,
      },
      request: {
        lineItems: Array.isArray(lineItems) ? lineItems : []
      },
      now: new Date().toISOString(),
    };

    return next();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[rules] buildRefundContext failed:", err.message);
    return res.status(500).json({ error: "Failed to build refund context" });
  }
}

/**
 * evaluateRefundRules(context)
 * Simple evaluator for dev. Extend as needed.
 * Returns a Decision object that includes rulesVersion & ruleSetId.
 */
function evaluateRefundRules(context) {
  const { rules, user, order, refund, meta, rulesVersion, ruleSetId } = context;
  const isPartial = Array.isArray(context?.request?.lineItems) && context.request.lineItems.length > 0;
  const bypass = rules?.bypassPercentCapForPartials !== false; // default true
  const matched = [];
  const limits = {};
  let outcome = "ALLOW";
  let reason = "Allowed by default";

  // 0) Cashback deny rule (uses context.meta.totalSpentCredits populated during context build)
  if (
    outcome !== "DENY" &&
    typeof meta?.totalSpentCreditsRaw === "number" &&
    Number.isFinite(meta.totalSpentCreditsRaw)
  ) {
    // If your Flits amounts are in paise (e.g., 39900), compare against that; otherwise adjust.
    const threshold = (typeof rules.cashbackSpentThreshold === 'number' && Number.isFinite(rules.cashbackSpentThreshold))
      ? rules.cashbackSpentThreshold
      : 39900; // default used in your earlier check
    limits.cashbackSpentThreshold = threshold;
    limits.observedCashbackSpentCreditsRaw = meta.totalSpentCreditsRaw;
    limits.observedCashbackSpentCredits = meta.totalSpentCredits; // normalized
    if (Math.abs(meta.totalSpentCreditsRaw) >= threshold) {
      matched.push("cashbackSpentThreshold");
      outcome = "DENY";
      reason = "Customer has already utilised cashback; refund not eligible";
    }
  }

  // --- A) Lifetime refund count ---
  if (
    outcome !== "DENY" &&
    typeof rules.maxLifetimeRefundCount === "number" &&
    rules.maxLifetimeRefundCount >= 0 &&
    typeof meta.lifetimeRefundCount === "number"
    ) {
        const projected = meta.lifetimeRefundCount + 1;
        limits.maxLifetimeRefundCount = rules.maxLifetimeRefundCount;
        if (projected > rules.maxLifetimeRefundCount) {
            matched.push("maxLifetimeRefundCount");
            outcome = "DENY";
            reason = `Lifetime refund count exceeded: ${projected} > ${rules.maxLifetimeRefundCount}`;
        }
    }

  // --- B) Refund window after delivery ---
  if (
   outcome !== "DENY" &&
   typeof rules.refundWindowDays === "number" &&
   rules.refundWindowDays >= 0
  ) {
   if (typeof meta.daysSinceDelivery === "number") {
     limits.refundWindowDays = rules.refundWindowDays;
     if (meta.daysSinceDelivery > rules.refundWindowDays) {
       matched.push("refundWindowDays");
       outcome = "DENY";
       reason = `Refund window exceeded: ${meta.daysSinceDelivery}d > ${rules.refundWindowDays}d after delivery`;
     }
   }
 }
    
  // 1) Already refunded?
  if (rules.blockIfAlreadyRefunded && meta.targetOrderAlreadyRefunded) {
    matched.push("blockIfAlreadyRefunded");
    outcome = "DENY";
    reason = "Order already has a refund recorded";
  }

  // 2) Percent cap
  if (
    !((isPartial && bypass)) &&
    outcome !== "DENY" &&
    typeof refund.requestedPercent === "number" &&
    typeof rules.maxRefundPercent === "number"
  ) {
    limits.maxRefundPercent = rules.maxRefundPercent;
    if (refund.requestedPercent > rules.maxRefundPercent) {
      matched.push("maxRefundPercent");
      outcome = "DENY";
      reason = `Requested ${refund.requestedPercent.toFixed(2)}% exceeds max ${rules.maxRefundPercent}%`;
    }
  }

  // 3) Daily attempt cap
  if (
    outcome !== "DENY" &&
    typeof rules.maxRefundsPerDay === "number" &&
    rules.maxRefundsPerDay >= 0
  ) {
    if (meta.attemptsToday >= rules.maxRefundsPerDay) {
      matched.push("maxRefundsPerDay");
      outcome = "DENY";
      reason = `Customer already hit ${meta.attemptsToday} refunds today (limit ${rules.maxRefundsPerDay})`;
    }
  }

  // 4) Payment method whitelist
  if (
    outcome !== "DENY" &&
    order &&
    Array.isArray(rules.allowPaymentMethods) &&
    rules.allowPaymentMethods.length
  ) {
    // Normalize both sides to be resilient to spaces, hyphens, underscores and punctuation
    const normalizePm = (s) =>
      String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ") // collapse non-alphanumerics to spaces
        .trim()
        .replace(/\s+/g, " "); // single-space

    const pmRaw = order.paymentMethod || "";
    const pm = normalizePm(pmRaw);
    const allowList = rules.allowPaymentMethods.map((x) => normalizePm(x));

    const isAllowed = pm && allowList.some((a) => a === pm || pm.includes(a) || a.includes(pm));
    if (!isAllowed) {
      matched.push("allowPaymentMethods");
      outcome = "DENY";
      reason = `Payment method ${pmRaw.toLowerCase()} is not allowed for refunds`;
    }
  }

  // 5) Supervisor requirement
  if (
    outcome !== "DENY" &&
    typeof refund.requestedPercent === "number" &&
    typeof rules.requireSupervisorAbovePercent === "number"
  ) {
    if (refund.requestedPercent > rules.requireSupervisorAbovePercent) {
      const hasSupervisor = (user.roles || []).includes("super_admin");
      matched.push("requireSupervisorAbovePercent");
      if (!hasSupervisor) {
        outcome = "REQUIRE_APPROVAL";
        reason = `Supervisor required above ${rules.requireSupervisorAbovePercent}%`;
      }
    }
  }

  return { outcome, reason, limits, matched, rulesVersion, ruleSetId };
}

/**
 * applyRefundRules(req,res,next)
 * Enforces mode: observe|warn|enforce.
 * - observe: never block (adds decision to res.locals)
 * - warn:    never block but attach warnings header/body
 * - enforce: block on DENY or REQUIRE_APPROVAL (unless actor is super_admin)
 */
function applyRefundRules(req, res, next) {
  try {
    const ctx = req.ruleContext;
    if (!ctx) return res.status(500).json({ error: "Rule context missing" });

    const rules = ctx.rules || { mode: "observe" };
    const decision = evaluateRefundRules(ctx);

    // Attach for downstream handler and for logging/audit
    res.locals.ruleDecision = decision;

    // observe → never block
    if (rules.mode === "observe") return next();

    // warn → attach header and continue
    if (rules.mode === "warn") {
      try {
        res.setHeader("X-Rule-Decision", JSON.stringify(decision));
      } catch (_) {}
      return next();
    }

    // enforce → block or require approval
    if (rules.mode === "enforce") {
      if (decision.outcome === "DENY") {
        return res.status(403).json({ error: "Refund denied by policy", decision });
      }
      if (decision.outcome === "REQUIRE_APPROVAL") {
        res.locals.requiresApproval = !(ctx.user.roles || []).includes("super_admin");
      }
      return next();
    }

    // unknown mode → treat as observe
    return next();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[rules] applyRefundRules failed:", err.message);
    return res.status(500).json({ error: "Failed to apply rules" });
  }
}

module.exports = {
  buildRefundContext,
  evaluateRefundRules,
  applyRefundRules,
};
