const mongoose = require("mongoose");
const { encrypt, decrypt } = require("../utils/encryption");

const tenantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  shopDomain: { type: String, required: true },
  apiVersion: { type: String, default: "2025-07" },

  // Sensitive fields
  accessToken: { 
    type: String, 
    required: true,
    set: v => (v ? encrypt(v) : v), 
    get: v => (v ? decrypt(v) : v)
  },
  apiKey: { type: String, required: true }, // public, no need to encrypt
  apiSecret: { 
    type: String, 
    required: true,
    set: v => (v ? encrypt(v) : v), 
    get: v => (v ? decrypt(v) : v)
  },

  // Optional settings
  settings: {
    refundRules: Object,
    cashbackRules: Object,
  }
}, { 
  timestamps: true,
  toJSON: { getters: true }, 
  toObject: { getters: true }
});

module.exports = mongoose.model("Tenant", tenantSchema);
