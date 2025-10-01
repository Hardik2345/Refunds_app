// controllers/rulesController.js
const factory = require("./handlerFactory");
const RefundRules = require("../models/refundRulesModel");
const redis = require("../utils/redisClient");

// -------- Helpers --------

function normalizeRules(input = {}) {
  const out = {};
  const toNum = (v) => (v === "" || v == null ? undefined : Number(v));
  const toInt = (v) => (v === "" || v == null ? undefined : parseInt(v, 10));
  const toBool = (v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "string") return ["true", "1", "yes", "on"].includes(v.toLowerCase());
    if (typeof v === "number") return v !== 0;
    return undefined;
  };
  // Accept arrays as-is; if a string is provided, split by comma or newline only
  // so values like "Cash on Delivery" are preserved.
  const toStrArr = (v) => {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === "string" && v.trim()) {
      return v
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return undefined;
  };

  // Allow-listed fields from RefundRulesPayloadSchema
  const mode = String(input.mode || "").toLowerCase();
  if (["observe", "warn", "enforce"].includes(mode)) out.mode = mode;

  const maxRefundPercent = toNum(input.maxRefundPercent);
  if (Number.isFinite(maxRefundPercent))
    out.maxRefundPercent = Math.min(Math.max(maxRefundPercent, 0), 100);

  const maxRefundsPerDay = toInt(input.maxRefundsPerDay);
  if (Number.isFinite(maxRefundsPerDay)) out.maxRefundsPerDay = Math.max(maxRefundsPerDay, 0);

  const allowPaymentMethods = toStrArr(input.allowPaymentMethods);
  if (allowPaymentMethods) out.allowPaymentMethods = allowPaymentMethods;

  const requireSupervisorAbovePercent = toNum(input.requireSupervisorAbovePercent);
  if (Number.isFinite(requireSupervisorAbovePercent))
    out.requireSupervisorAbovePercent = Math.min(Math.max(requireSupervisorAbovePercent, 0), 100);

  const bypassPercentCapForPartials = toBool(input.bypassPercentCapForPartials);
  if (typeof bypassPercentCapForPartials === "boolean")
    out.bypassPercentCapForPartials = bypassPercentCapForPartials;

  const refundWindowDays = toInt(input.refundWindowDays);
  if (Number.isFinite(refundWindowDays)) out.refundWindowDays = Math.max(refundWindowDays, 0);

  const blockIfAlreadyRefunded = toBool(input.blockIfAlreadyRefunded);
  if (typeof blockIfAlreadyRefunded === "boolean")
    out.blockIfAlreadyRefunded = blockIfAlreadyRefunded;

  // Lifetime refund COUNT cap (you added this logic)
  const maxLifetimeRefundCount = toInt(input.maxLifetimeRefundCount);
  if (Number.isFinite(maxLifetimeRefundCount))
    out.maxLifetimeRefundCount = Math.max(maxLifetimeRefundCount, 0);

  return out;
}

async function invalidateRulesCache(tenantId) {
  const key = `refundRules:${tenantId || "platform"}`;
  try {
    await redis.del(key);
  } catch {
    /* noop */
  }
}

// -------- CRUD (via handlerFactory) --------

exports.createRefundRules = factory.createOne(RefundRules);
exports.getRefundRules = factory.getOne(RefundRules);
exports.getAllRefundRules = factory.getAll(RefundRules);
exports.updateRefundRules = factory.updateOne(RefundRules);
exports.deleteRefundRules = factory.deleteOne(RefundRules);

// -------- High-level endpoints --------

/**
 * GET /api/v1/rules/active
 * Returns the active ruleset (tenant-scoped, with platform fallback).
 */
exports.getActive = async (req, res) => {
  try {
    const tenantId = req.tenant?._id || null;
    const active = await RefundRules.getActiveForTenant(tenantId);
    if (!active) {
      return res
        .status(404)
        .json({ status: "fail", message: "No active ruleset found" });
    }
    res.status(200).json({ status: "success", data: active });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};

/**
 * GET /api/v1/rules/versions?limit=20
 * Lists recent versions for this tenant.
 */
exports.listVersions = async (req, res) => {
  try {
    const tenantId = req.tenant?._id || null;
    const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
    const q = { tenant: tenantId };
    const docs = await RefundRules.find(q).sort({ version: -1 }).limit(limit).lean();
    res.status(200).json({ status: "success", data: docs });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};

/**
 * POST /api/v1/rules/publish
 * Body: either { rules: {...} } or the rules object directly.
 * Publishes a new active ruleset version (deactivates previous).
 */
exports.publish = async (req, res) => {
  try {
    const tenantId = req.tenant?._id || null;
    const createdBy = req.user?._id || null;

    const raw = req.body?.rules || req.body || {};
    const rulesPayload = normalizeRules(raw);

    const doc = await RefundRules.publishNewVersion(tenantId, rulesPayload, createdBy);

    await invalidateRulesCache(tenantId);

    res.status(201).json({ status: "success", data: doc });
  } catch (err) {
    res.status(400).json({ status: "fail", message: err.message });
  }
};

/**
 * POST /api/v1/rules/simulate
 * Body: { ctx: {...}, rules?: {...override} }
 * Returns a decision using active rules + optional overrides.
 */
exports.simulate = async (req, res) => {
  try {
    // Lazy import to avoid circular deps
    const { evaluateRefundRules } = require("../middlewares/rules");

    const tenantId = req.tenant?._id || null;
    const active = await RefundRules.getActiveForTenant(tenantId);
    const baseRules = active?.rules || { mode: "observe" };

    const override = normalizeRules(req.body?.rules || {});
    const rules = { ...baseRules, ...override };

    const ctx = req.body?.ctx || {};
    ctx.rules = rules;
    ctx.rulesVersion = active?.version ?? 0;
    ctx.ruleSetId = active?._id ? String(active._id) : null;

    const decision = evaluateRefundRules(ctx);
    res.status(200).json({ status: "success", data: { rules, decision } });
  } catch (err) {
    res.status(400).json({ status: "fail", message: err.message });
  }
};

/**
 * POST /api/v1/rules/deactivate
 * Deactivate the current active ruleset for this tenant.
 */
exports.deactivateActive = async (req, res) => {
  try {
    const tenantId = req.tenant?._id || null;
    const active = await RefundRules.findOne({ tenant: tenantId, isActive: true });
    if (!active) {
      return res.status(404).json({ status: "fail", message: "No active ruleset" });
    }
    active.isActive = false;
    await active.save();
    await invalidateRulesCache(tenantId);
    res.status(200).json({ status: "success" });
  } catch (err) {
    res.status(400).json({ status: "fail", message: err.message });
  }
};
