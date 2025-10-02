// models/userAuditModel.js
const mongoose = require('mongoose');
const { Schema, Types } = mongoose;

const UserAuditSchema = new Schema(
  {
    action: {
      type: String,
      enum: ['USER_CREATED', 'USER_DELETED', 'USER_RESTORED'],
      required: true,
      index: true,
    },

    // who performed the action
    actor: { type: Types.ObjectId, ref: 'User', required: true, index: true },

    // which user was affected
    targetUser: { type: Types.ObjectId, ref: 'User', required: true, index: true },

    // optional tenant context
    tenant: { type: Types.ObjectId, ref: 'Tenant', default: null, index: true },

    // snapshot data for forensics
    meta: {
      email: String,
      name: String,
      role: String,
      phone: String,
      reason: String, // optional free-text
    },

    // request context
    ip: String,
    userAgent: String,
    requestId: String, // if you generate one per request
  },
  { timestamps: true }
);

UserAuditSchema.index({ createdAt: -1 });

module.exports = mongoose.model('UserAudit', UserAuditSchema);
