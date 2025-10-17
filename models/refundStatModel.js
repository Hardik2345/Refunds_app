// models/refundStatModel.js
const mongoose = require("mongoose");
const { Schema, Types } = mongoose;

/**
 * Lightweight, queryable trail of recent attempts (ring buffer semantics).
 * Keep this compact: strings, codes, and small blobs only.
 */
const AttemptSchema = new Schema({
  at:         { type: Date, default: Date.now },
  action:     { type: String, enum: ["preview","refund","approve","deny"], required: true },
  outcome:    { type: String, enum: ["ALLOW","DENY","REQUIRE_APPROVAL","ERROR","SUCCESS"], required: true },
  httpCode:   { type: Number, default: null },      // e.g., 403 from rules, 5xx from Shopify
  errorCode:  { type: String, default: null },      // compact reason: ECONNRESET, RATE_LIMIT, POLICY_DENIED, etc.
  errorMsg:   { type: String, default: null },      // truncated (keep to <= 500 chars)
  attemptNo:  { type: Number, default: 1 },         // retry number for this action
  backoffMs:  { type: Number, default: 0 },         // chosen backoff for *next* attempt
  // Actor who performed this attempt
  actor:      { type: Types.ObjectId, ref: "User", default: null },
  // Context thumbnails for forensics (tiny!)
  orderId:    { type: String, default: null },
  amount:     { type: Number, default: null },
  partial:    { type: Boolean, default: false },
  ruleSetId:  { type: String, default: null },
  rulesVer:   { type: Number, default: null },
}, { _id: false });

const RefundStatSchema = new Schema({
  // Ledger identity
  user:     { type: Types.ObjectId, ref: "User", required: true, index: true },
  tenant:   { type: Types.ObjectId, ref: "Tenant", required: true, index: true },
  customer: { type: String, required: true, index: true }, // "phone:..." or "email:..."

  // Aggregate counters
  totalCount:      { type: Number, default: 0 },   // successful refunds
  successCount:    { type: Number, default: 0 },
  failureCount:    { type: Number, default: 0 },

  // Last activity snapshots (fast reads for dashboards/guards)
  lastRefundAt:    { type: Date, default: null },
  lastIp:          { type: String, default: null },
  lastOutcome:     { type: String, enum: ["SUCCESS","ERROR","DENY","REQUIRE_APPROVAL", null], default: null },
  lastErrorCode:   { type: String, default: null },
  lastErrorMsg:    { type: String, default: null },
  lastOrderId:     { type: String, default: null },
  lastAmount:      { type: Number, default: null },
  lastPartial:     { type: Boolean, default: false },
  lastRuleSetId:   { type: String, default: null },
  lastRulesVer:    { type: Number, default: null },

  // Retry scheduling (exponential backoff WITHOUT jitter)
  retryCount:      { type: Number, default: 0 },             // consecutive failures for current action
  nextRetryAt:     { type: Date, default: null },            // when a worker should retry
  retryBaseMs:     { type: Number, default: 250 },           // base backoff seed (configurable per tenant later)
  maxRetryMs:      { type: Number, default: 30_000 },        // cap
  lastAttemptAt:   { type: Date, default: null },

  // Correlation / idempotency
  lastCorrelationId: { type: String, default: null, index: true }, // tie multiple logs across services
  lastRefundId:      { type: String, default: null },              // Shopify refund id when success (idempotency guard)

  // Compact trail (keep it small — e.g., 25 entries)
  attempts: {
    type: [AttemptSchema],
    default: [],
    // We'll prune in code to bounded length
  },
}, { timestamps: true });

// Uniqueness: one ledger per tenant+customer (as you had)
RefundStatSchema.index({ tenant: 1, customer: 1 }, { unique: true });

// Fast queries to find due retries and hot failure accounts
RefundStatSchema.index({ tenant: 1, nextRetryAt: 1 });
RefundStatSchema.index({ tenant: 1, failureCount: -1 });
// For filtering logs by user accurately (matches any attempt actor)
RefundStatSchema.index({ tenant: 1, 'attempts.actor': 1, lastRefundAt: -1 });

/**
 * Compute exponential backoff (no jitter).
 * attempt = 1 -> base
 * attempt = 2 -> base * 2
 * ...
 */
RefundStatSchema.methods.computeBackoffMs = function() {
  const a = Math.max(1, this.retryCount);
  const ms = Math.min(this.retryBaseMs * (2 ** (a - 1)), this.maxRetryMs);
  return ms;
};

/**
 * Push an attempt into the ring buffer (bounded).
 */
RefundStatSchema.methods.pushAttempt = function(entry, maxEntries = 25) {
  this.attempts.push(entry);
  if (this.attempts.length > maxEntries) {
    this.attempts.splice(0, this.attempts.length - maxEntries);
  }
};

module.exports = mongoose.model("RefundStat", RefundStatSchema);
