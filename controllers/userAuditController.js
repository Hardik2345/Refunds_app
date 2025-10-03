const UserAudit = require('../models/userAuditModel');
const catchAsync = require('./../utils/catchAsync');

// GET /api/v1/user-audits
// Query params: page, limit, sort, action, actor, targetUser, tenant, from, to
exports.listAudits = catchAsync(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    sort = '-createdAt',
    action,
    actor,
    targetUser,
    tenant,
    from,
    to,
  } = req.query || {};

  const filter = {};
  if (action) filter.action = action;
  if (actor) filter.actor = actor;
  if (targetUser) filter.targetUser = targetUser;
  // Enforce tenant scoping from middleware
  if (req.tenant?._id) {
    filter.tenant = req.tenant._id;
  } else if (tenant) {
    // fallback if middleware didn't attach tenant for any reason
    filter.tenant = tenant;
  }
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(String(from));
    if (to) filter.createdAt.$lte = new Date(String(to));
  }

  const p = Math.max(1, parseInt(page));
  const l = Math.max(1, Math.min(200, parseInt(limit)));

  const query = UserAudit.find(filter)
    .sort(String(sort))
    .skip((p - 1) * l)
    .limit(l)
    .populate({ path: 'actor', select: 'name email role', options: { includeInactive: true } })
    .populate({ path: 'targetUser', select: 'name email role', options: { includeInactive: true } })
    .populate({ path: 'tenant', select: 'name' });

  const [items, total] = await Promise.all([
    query,
    UserAudit.countDocuments(filter),
  ]);

  res.status(200).json({
    status: 'success',
    results: items.length,
    page: p,
    limit: l,
    total,
    data: { data: items },
  });
});
