// models/pendingRefundModel.js
const mongoose = require("mongoose");
const { Schema, Types } = mongoose;

const PendingRefundSchema = new Schema({
  tenant: { type: Types.ObjectId, ref: "Tenant", index: true, required: true },
  requester: { type: Types.ObjectId, ref: "User", index: true, required: true },

  // what was requested
  payload: {
    phone: String,
    orderId: String,
    amount: { type: Number, required: true }
  },

  // snapshot for audit & reproducibility
  ruleDecision: {
    outcome: { type: String, enum: ["REQUIRE_APPROVAL"], required: true },
    reason: String,
    limits: Schema.Types.Mixed,
    matched: [String],
    rulesVersion: Number,
    ruleSetId: { type: String }
  },

  // optional context snapshot (helps supervisors)
  context: Schema.Types.Mixed,

  status: {
    type: String,
    enum: ["PENDING", "APPROVED", "DENIED"],
    default: "PENDING",
    index: true
  },

  resolvedBy: { type: Types.ObjectId, ref: "User", default: null },
  resolvedAt: { type: Date, default: null }
}, { timestamps: true });

PendingRefundSchema.index({ tenant: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("PendingRefund", PendingRefundSchema);
