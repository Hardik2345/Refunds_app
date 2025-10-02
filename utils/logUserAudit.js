// utils/logUserAudit.js
const UserAudit = require('../models/userAuditModel');

exports.logUserAudit = async function logUserAudit({
  action,
  actorId,
  targetUser,
  tenantId = null,
  req = null,
  meta = {},
}) {
  try {
    const ip =
      (req?.headers?.['x-forwarded-for']?.split(',')[0] || '').trim() ||
      req?.ip ||
      null;

    await UserAudit.create({
      action,
      actor: actorId,
      targetUser: targetUser?._id || targetUser,
      tenant: tenantId,
      meta: {
        email: targetUser?.email,
        name: targetUser?.name,
        role: targetUser?.role,
        phone: targetUser?.phone,
        ...meta,
      },
      ip,
      userAgent: req?.headers?.['user-agent'] || null,
      requestId: req?.id || req?.requestId || null,
    });
  } catch (e) {
    // never block the main flow because of logging
    console.warn('[UserAudit] failed to write audit log:', e.message);
  }
};
