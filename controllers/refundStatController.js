const RefundStat = require('../models/refundStatModel');
const catchAsync = require('../utils/catchAsync');

// Ensure queries are scoped to the resolved tenant
exports.scopeToTenant = (req, res, next) => {
  if (req.tenant?._id) {
    // Force tenant scoping regardless of client query
    req.query.tenant = req.tenant._id.toString();
  }
  next();
};

// If a userId is present in params, propagate to query filter
exports.setUserFilter = (req, res, next) => {
  if (req.params.userId) {
    req.query.user = req.params.userId;
  }
  next();
};

// Convert day/startDate/endDate query or params into lastRefundAt range filter
exports.setDateFilters = (req, res, next) => {
  const day = req.params.date || req.query.day; // YYYY-MM-DD expected
  const startDate = req.query.startDate;
  const endDate = req.query.endDate;

  // Helper to build ISO start/end
  function buildDayRange(input) {
    const d = new Date(input);
    if (isNaN(d.getTime())) return null;
    // Use UTC to avoid TZ ambiguity across clients
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
    return { start, end };
  }

  const range = day ? buildDayRange(day) : null;
  const start = range?.start || (startDate ? new Date(startDate) : null);
  const end = range?.end || (endDate ? new Date(endDate) : null);

  if (start && isNaN(start.getTime())) return next();
  if (end && isNaN(end.getTime())) return next();

  if (start || end) {
    const filter = {};
    if (start) filter.gte = start.toISOString();
    if (end) filter.lte = end.toISOString();
    // APIFeatures supports operators when passed as nested object
    req.query.lastRefundAt = filter;
  }

  next();
};

// Aggregation-based listing to support filtering by attempts.actor accurately
exports.getAllRefundStats = catchAsync(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    sort = '-lastRefundAt',
    tenant,
    user, // when provided, match any attempt actor
    lastRefundAt,
    phone,
  } = req.query || {};

  const p = Math.max(1, parseInt(page));
  const l = Math.max(1, Math.min(200, parseInt(limit)));

  const match = {};
  if (tenant) match.tenant = typeof tenant === 'string' ? RefundStat.db.cast(RefundStat.collection.name, 'tenant', tenant) : tenant;
  if (lastRefundAt && (lastRefundAt.gte || lastRefundAt.lte)) {
    match.lastRefundAt = {};
    if (lastRefundAt.gte) match.lastRefundAt.$gte = new Date(String(lastRefundAt.gte));
    if (lastRefundAt.lte) match.lastRefundAt.$lte = new Date(String(lastRefundAt.lte));
  }
  // Note: do not match by top-level user when filtering by actor; we'll match attempts.actor

  const pipeline = [];
  if (Object.keys(match).length) pipeline.push({ $match: match });
  // Phone search: match customer key written as `phone:<value>` accommodating optional +91 and leading zeros
  if (phone && String(phone).trim()) {
    const raw = String(phone).trim();
    const digits = raw.replace(/\D/g, '');
    if (digits) {
      const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
      const patterns = [
        new RegExp(`^phone:(?:\\+?91)?0*${last10}$`, 'i'),
        new RegExp(`^phone:${digits}$`, 'i'),
      ];
      pipeline.push({ $match: { $or: patterns.map(r => ({ customer: { $regex: r } })) } });
    }
  }
  if (user) {
    pipeline.push({ $match: { 'attempts.actor': RefundStat.db.cast(RefundStat.collection.name, 'attempts.actor', user) } });
  }

  // Sorting
  const sortStage = {};
  if (typeof sort === 'string' && sort.trim()) {
    const fields = sort.split(',').map(s => s.trim()).filter(Boolean);
    for (const f of fields) {
      if (f.startsWith('-')) sortStage[f.slice(1)] = -1; else sortStage[f] = 1;
    }
  } else {
    sortStage.lastRefundAt = -1;
  }
  pipeline.push({ $sort: sortStage });

  // Pagination
  pipeline.push({ $skip: (p - 1) * l }, { $limit: l });

  // Lookups for user (last actor id in `user`) and tenant; include inactive by bypassing Mongoose middleware (native $lookup)
  pipeline.push(
    { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'user' } },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'tenants', localField: 'tenant', foreignField: '_id', as: 'tenant' } },
    { $unwind: { path: '$tenant', preserveNullAndEmptyArrays: true } }
  );

  console.log('Pipeline:', JSON.stringify(pipeline, null, 2));

  const totalPipeline = [
    ...(Object.keys(match).length ? [{ $match: match }] : []),
    ...(phone && String(phone).trim() ? (() => {
      const raw = String(phone).trim();
      const digits = raw.replace(/\D/g, '');
      if (!digits) return [];
      const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
      const patterns = [
        new RegExp(`^phone:(?:\\+?91)?0*${last10}$`, 'i'),
        new RegExp(`^phone:${digits}$`, 'i'),
      ];
      return [{ $match: { $or: patterns.map(r => ({ customer: { $regex: r } })) } }];
    })() : []),
    ...(user ? [{ $match: { 'attempts.actor': RefundStat.db.cast(RefundStat.collection.name, 'attempts.actor', user) } }] : []),
    { $count: 'count' }
  ];

  const [items, totalArr] = await Promise.all([
    RefundStat.aggregate(pipeline),
    RefundStat.aggregate(totalPipeline)
  ]);
  const total = totalArr[0]?.count || 0;

  res.status(200).json({
    status: 'success',
    results: items.length,
    page: p,
    limit: l,
    total,
    data: { data: items }
  });
});

// Keep single-get via factory (populate not critical here)
const handlerFactory = require('./handlerFactory');
exports.getRefundStat = handlerFactory.getOne(RefundStat);

// DELETE /api/v1/refund-stats
// Query: from, to, phone (matches same as list), tenant via middleware; require at least one of tenant or date/phone
exports.deleteRefundStats = catchAsync(async (req, res, next) => {
  const { from, to, phone } = req.query || {};

  const match = {};
  if (req.tenant?._id) match.tenant = req.tenant._id;

  if (phone && String(phone).trim()) {
    const raw = String(phone).trim();
    const digits = raw.replace(/\D/g, '');
    if (digits) {
      const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
      match.$or = [
        { customer: { $regex: new RegExp(`^phone:(?:\\+?91)?0*${last10}$`, 'i') } },
        { customer: { $regex: new RegExp(`^phone:${digits}$`, 'i') } },
      ];
    }
  }

  if (from || to) {
    match.lastRefundAt = {};
    if (from) match.lastRefundAt.$gte = new Date(String(from));
    if (to) match.lastRefundAt.$lte = new Date(String(to));
  }

  if (!match.tenant && !match.lastRefundAt && !match.$or) {
    return res.status(400).json({ error: 'Provide a tenant (x-tenant-id), phone, or a date range (from/to) to delete refund logs.' });
  }

  const result = await RefundStat.deleteMany(match);
  return res.status(200).json({ status: 'success', deletedCount: result?.deletedCount || 0 });
});
