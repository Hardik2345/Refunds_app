const crypto = require('crypto');
const WebhookEvent = require('../models/webhookEvent');

// Quick, minimal validation + normalization
function requiredString(v, field) {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${field} is required`);
  return v.trim();
}

function requiredNumber(v, field) {
  if (typeof v !== 'number' || Number.isNaN(v)) throw new Error(`${field} must be a number`);
  return v;
}

function toDateStrict(input, field) {
  // Accepts "YYYY-MM-DD" or "YYYY-MM-DD HH:mm:ss"
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new Error(`${field} must be a valid date`);
  return d;
}

// Build a deterministic idempotency key from the payload
function makeIdempotencyKey(body) {
  // Choose stable fields that define the event identity
  const pick = {
    adjustedPoint: body['adjusted point'] ?? body['adjusted_point'] ?? body.adjustedPoint,
    oldPoint:      body['old point'] ?? body['old_point'] ?? body.oldPoint,
    currentPoint:  body['current point'] ?? body['current_point'] ?? body.currentPoint,
    type:          body.type,
    module_on:     body.module_on,
    reason:        body.reason,
    orderId:       body['order Id'] ?? body.orderId,
    expiry_date:   body.expiry_date,
    created_at:    body.created_at,
    email:         body.email,
  };
  const str = JSON.stringify(pick);
  return crypto.createHash('sha256').update(str).digest('hex');
}

exports.handleRewardsWebhook = async (req, res) => {
  try {
    const b = req.body || {};

    // Allow snakeCase / spaces / camelCase gracefully
    const adjustedPoint = Number(b['adjusted point'] ?? b.adjustedPoint);
    const oldPoint      = Number(b['old point'] ?? b.oldPoint);
    const currentPoint  = Number(b['current point'] ?? b.currentPoint);
    const type          = requiredString(b.type, 'type');
    const module_on     = requiredString(b.module_on, 'module_on');
    const reason        = requiredString(b.reason, 'reason');
    const orderId       = requiredNumber(b['order Id'] ?? b.orderId, 'order Id');
    const expiryDate    = toDateStrict(b.expiry_date, 'expiry_date');
    const createdAtSrc  = toDateStrict(b.created_at, 'created_at');
    const email         = requiredString(b.email, 'email').toLowerCase();
    const firstName     = requiredString(b.firstName, 'firstName');
    const lastName      = requiredString(b.lastName, 'lastName');

    // Basic numeric checks
    [ ['adjusted point', adjustedPoint], ['old point', oldPoint], ['current point', currentPoint] ]
      .forEach(([label, val]) => {
        if (typeof val !== 'number' || Number.isNaN(val)) {
          throw new Error(`${label} must be a decimal number`);
        }
      });

    // Optional: shared-secret verification (if upstream sends a signature)
    // const signature = req.header('X-Webhook-Signature');
    // verifySignatureOrThrow(signature, req.rawBody, process.env.WEBHOOK_SECRET);

    const idempotencyKey = makeIdempotencyKey(b);

    const doc = await WebhookEvent.findOneAndUpdate(
      { idempotencyKey },
      {
        adjustedPoint,
        oldPoint,
        currentPoint,
        type,
        module_on,
        reason,
        orderId,
        expiryDate,
        createdAtSrc,
        email,
        firstName,
        lastName,
        raw: b,
        idempotencyKey,
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({
      ok: true,
      id: doc._id,
      receivedAt: doc.createdAt,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
};
