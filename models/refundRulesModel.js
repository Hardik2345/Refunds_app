// models/refundRulesModel.js
// A tenant-scoped, versioned ruleset for refunds.
// One active ruleset per tenant enforced via a partial unique index.

const mongoose = require("mongoose");
const { Schema, Types } = mongoose;

// --- Rule payload mirrors schemas/refundRules.schema.json ---
const RefundRulesPayloadSchema = new Schema(
  {
    mode: {
      type: String,
      enum: ["observe", "warn", "enforce"],
      default: "observe",
      required: true,
    },
    maxRefundPercent: {
      type: Number,
      min: 0,
      max: 100,
      default: 30,
    },
    maxRefundsPerDay: {
      type: Number,
      min: 0,
      default: 2,
    },
    allowPaymentMethods: {
      type: [String],
      default: ["card", "upi", "cod"],
    },
    requireSupervisorAbovePercent: {
      type: Number,
      min: 0,
      max: 100,
      default: 20,
    },
    bypassPercentCapForPartials: { type: Boolean, default: true },
    refundWindowDays: { type: Number, min: 0, default: null },
    blockIfAlreadyRefunded: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

// --- Top-level ruleset document ---
const RefundRulesSchema = new Schema(
  {
    // null tenant means "platform default"
    tenant: {
      type: Types.ObjectId,
      ref: "Tenant",
      default: null,
      index: true,
    },

    name: {
      type: String,
      default: "Refund Rules",
      trim: true,
    },

    // simple monotonically increasing integer; higher = newer
    version: {
      type: Number,
      required: true,
      default: 1,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    // who created/published this ruleset (optional)
    createdBy: {
      type: Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    // actual rule payload
    rules: {
      type: RefundRulesPayloadSchema,
      required: true,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
    minimize: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// --- Indexes ---
// 1) Ensure only ONE active ruleset per tenant.
//    Using a partial unique index scoped to isActive:true.
//    Also works for platform default (tenant:null).
RefundRulesSchema.index(
  { tenant: 1, isActive: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true },
  }
);

// 2) Fast lookup of newest rules per tenant.
RefundRulesSchema.index({ tenant: 1, version: -1 });

// 3) Housekeeping / recency queries.
RefundRulesSchema.index({ updatedAt: -1 });

// --- Statics / helpers ---

/**
 * Get the active ruleset for a tenant, or fall back to platform default.
 * @param {ObjectId|null} tenantId
 */
RefundRulesSchema.statics.getActiveForTenant = async function (tenantId) {
  const model = this;

  // Try tenant-specific
  const tenantActive = await model
    .findOne({ tenant: tenantId, isActive: true })
    .lean();

  if (tenantActive) return tenantActive;

  // Fallback: platform default (tenant:null)
  const platformDefault = await model
    .findOne({ tenant: null, isActive: true })
    .lean();

  return platformDefault || null;
};

/**
 * Publish a new version for a tenant (deactivate old, insert new).
 * @param {ObjectId|null} tenantId
 * @param {Object} rulesPayload (matches RefundRulesPayloadSchema)
 * @param {ObjectId|null} createdBy
 */
RefundRulesSchema.statics.publishNewVersion = async function (
  tenantId,
  rulesPayload,
  createdBy = null
) {
  const session = await this.db.startSession();
  session.startTransaction();
  try {
    const model = this;

    // Determine next version
    const latest = await model
      .findOne({ tenant: tenantId })
      .sort({ version: -1 })
      .select({ version: 1 })
      .session(session);

    const nextVersion = latest ? latest.version + 1 : 1;

    // Deactivate any currently active ruleset
    await model.updateMany(
      { tenant: tenantId, isActive: true },
      { $set: { isActive: false } },
      { session }
    );

    // Create new active ruleset
    const doc = await model.create(
      [
        {
          tenant: tenantId || null,
          version: nextVersion,
          isActive: true,
          createdBy: createdBy || null,
          rules: rulesPayload || {},
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();
    return doc[0];
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
};

const RefundRules = mongoose.model("RefundRules", RefundRulesSchema);
module.exports = RefundRules;
