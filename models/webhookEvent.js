const mongoose = require('mongoose');
const { Decimal128 } = mongoose.Schema.Types;

const WebhookEventSchema = new mongoose.Schema(
  {
    adjustedPoint: { type: Decimal128, required: true },
    oldPoint:      { type: Decimal128, required: true },
    currentPoint:  { type: Decimal128, required: true },
    type:       { type: String, required: true, trim: true },           
    module_on:  { type: String, required: true, trim: true },           
    reason:     { type: String, required: true, trim: true },           
    orderId:    { type: Number, required: true },                        
    expiryDate: { type: Date, required: true },                          
    createdAtSrc: { type: Date, required: true },                        
    email:     { type: String, required: true, lowercase: true, trim: true, index: true },
    firstName: { type: String, required: true, trim: true },
    lastName:  { type: String, required: true, trim: true },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
  },
  {
    timestamps: true, 
    versionKey: false,
  }
);

WebhookEventSchema.index({ email: 1, orderId: 1, type: 1, reason: 1 });

module.exports = mongoose.model('WebhookEvent', WebhookEventSchema);
