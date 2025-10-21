const AppError = require('../utils/appError');
const User = require('./../models/userModel');
const catchAsync = require('./../utils/catchAsync');
const factory = require('./handlerFactory');
const { logUserAudit } = require('../utils/logUserAudit');
const APIFeatures = require('../utils/apiFeatures');

const filterObj = (obj, ...allowedFields) => {
  const newObj = {};
  Object.keys(obj).forEach((el) => {
    if (allowedFields.includes(el)) {
      newObj[el] = obj[el];
    }
  });
  return newObj;
};

exports.getMe = (req, res, next) => {
  req.params.id = req.user.id;
  next();
};

exports.updateMe = catchAsync(async (req, res, next) => {
  //1) Create error if user posts password data
  if (req.body.password || req.body.passwordConfirm) {
    return next(
      new AppError(
        'This route is not for password updates! Please use another route',
        400,
      ),
    );
  }

  //2) filtered out unwanted field names that are not allowed to be updated
  const filteredBody = filterObj(req.body, 'name', 'email');
  if (req.file) filteredBody.photo = req.file.filename;

  //3) update user document
  const updatedUser = await User.findByIdAndUpdate(req.user.id, filteredBody, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    status: 'success',
    data: {
      user: updatedUser,
    },
  });
});

exports.deleteMe = catchAsync(async (req, res, next) => {
  const user = await User.findByIdAndUpdate(req.user.id, { isActive: false }, { new: true });

  logUserAudit({
    action: 'USER_DELETED',
    actorId: req.user._id,
    targetUser: user,
    tenantId: user.storeId || null,
    req,
    meta: { reason: 'self_delete' },
  });

  res.status(204).json({
    status: 'success',
    data: null,
  });
});

exports.createUser = catchAsync(async (req, res, next) => {
  const { name, email, phone, storeId, role, password, passwordConfirm } = req.body || {};

  if (!name || !email || !password || !passwordConfirm) {
    return next(new AppError('name, email, password, passwordConfirm are required', 400));
  }

  const targetRole = role || 'refund_agent';

  // --- Super admin restrictions: cannot create platform_admin and is tenant-bound
  const requesterRole = req.user?.role;
  const requesterTenantId = req.user?.storeId || req.user?.tenantId || null;

  if (requesterRole === 'super_admin') {
    if (targetRole === 'platform_admin') {
      return next(new AppError('super_admin cannot create platform_admin users', 403));
    }
    if (!requesterTenantId) {
      return next(new AppError('Your account is not assigned to a tenant', 403));
    }
  }

  // For non-platform_admin users, ensure tenant (storeId) is set correctly
  if (targetRole !== 'platform_admin') {
    const tenantForUser = requesterRole === 'super_admin' ? requesterTenantId : storeId;
    if (!tenantForUser) {
      return next(new AppError('storeId is required for non-platform_admin users', 400));
    }
    req.body.storeId = tenantForUser; // force tenant for super_admin
  }

  // ---------- RESURRECT (undelete) if a soft-deleted user with same email exists ----------
  // We only allow resurrect if there is exactly one user with this email and isActive:false
  // If an active user exists, we block to preserve uniqueness.
  const existing = await User.findOne({ email }, null, { includeInactive: true }).select('+isActive +password');

  if (existing && existing.isActive) {
    // isActive user already exists with this email
    return next(new AppError('Email already in use', 400));
  }

  if (existing && existing.isActive === false) {
    // "Undelete" the user: reactivate and refresh credentials/fields
    existing.name = name ?? existing.name;
    existing.phone = phone ?? existing.phone;
    existing.role = targetRole ?? existing.role;

    // only set storeId for non-platform_admin; keep undefined for platform_admin
    if (targetRole === 'platform_admin') {
      existing.storeId = undefined;
    } else {
      existing.storeId = req.body.storeId || existing.storeId;
    }

    existing.isActive = true;
    existing.password = password;
    existing.passwordConfirm = passwordConfirm;

    // Save triggers validators & hashing middleware
    const resurrected = await existing.save();

    // (Optional, but recommended): revoke any old refresh tokens/sessions for this user here.

    await logUserAudit({
      action: 'USER_RESTORED',
      actorId: req.user._id,
      targetUser: resurrected,
      tenantId: resurrected.storeId || null,
      req,
      meta: { reason: 'soft_deleted_account_reactivated' }
    });

    resurrected.password = undefined;
    return res.status(200).json({
      status: 'success',
      data: { user: resurrected },
    });
  }

  // ---------- No existing user — create new ----------
  const user = await User.create({
    name,
    email,
    phone,
    storeId: targetRole === 'platform_admin' ? undefined : req.body.storeId,
    role: targetRole,
    password,
    passwordConfirm,
  });

  await logUserAudit({
    action: 'USER_CREATED',
    actorId: req.user._id,
    targetUser: user,
    tenantId: user.storeId || null,
    req,
  });

  user.password = undefined;
  return res.status(201).json({
    status: 'success',
    data: { user },
  });
});

exports.getUser = factory.getOne(User);

// List users with role-based scoping:
// - super_admin: scoped to their assigned tenant (storeId)
// - platform_admin, user_admin: unscoped (can see all)
exports.getAllUsers = catchAsync(async (req, res, next) => {
  let filter = {};
  const role = req.user?.role;
  if (role === 'super_admin') {
    const tenantId = req.user?.storeId || req.user?.tenantId || null;
    if (!tenantId) {
      return next(new AppError('Your account is not assigned to a tenant', 403));
    }
    filter = { storeId: tenantId };
  }

  // Respect includeInactive=true to fetch soft-deleted users as well
  const includeInactive = String(req.query?.includeInactive || '').toLowerCase() === 'true';
  // Prevent APIFeatures.filter from treating includeInactive as a filter field
  if (req.query && Object.prototype.hasOwnProperty.call(req.query, 'includeInactive')) {
    delete req.query.includeInactive;
  }

  let baseQuery = User.find(filter, null, includeInactive ? { includeInactive: true } : {})
    .populate({ path: 'storeId', select: 'name' });
  const features = new APIFeatures(baseQuery, req.query)
    .filter()
    .sort()
    .limitFields()
    .pagination();
  const doc = await features.query;

  res.status(200).json({
    status: 'success',
    results: doc.length,
    data: { data: doc },
  });
});

// Custom update to allow reactivating soft-deleted users and log audit entries
exports.updateUser = catchAsync(async (req, res, next) => {
  const id = req.params.id;
  // Fetch including inactive so we can reactivate
  const existing = await User.findById(id, null, { includeInactive: true });
  if (!existing) {
    return next(new AppError('No user found with that ID', 404));
  }

  const wasActive = existing.isActive !== false; // treat undefined as active

  // Only allow certain fields to be updated via this endpoint
  const allowed = ['name', 'email', 'phone', 'role', 'storeId', 'isActive'];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      existing[key] = req.body[key];
    }
  }

  // Prevent password updates here
  if (req.body.password || req.body.passwordConfirm) {
    return next(new AppError('Use the appropriate password update route', 400));
  }

  const updated = await existing.save();

  // If transitioned from inactive -> active, log USER_RESTORED
  const isNowActive = updated.isActive !== false;
  if (!wasActive && isNowActive) {
    await logUserAudit({
      action: 'USER_RESTORED',
      actorId: req.user._id,
      targetUser: updated,
      tenantId: updated.storeId || null,
      req,
      meta: { reason: 'reactivated_by_admin' }
    });
  }

  updated.password = undefined;
  res.status(200).json({
    status: 'success',
    data: { data: updated },
  });
});
exports.deleteUser = async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true, runValidators: true }
    );

    if (!user) {
      return next(new AppError('No user found with that ID', 404));
    }

    logUserAudit({
      action: 'USER_DELETED',
      actorId: req.user._id,
      targetUser: user,
      tenantId: user.storeId || null,
      req,
    });

    res.status(204).json({
      status: 'success',
      data: null
    });
  } catch (err) {
    next(err);
  }
};