const AppError = require('../utils/appError');
const User = require('./../models/userModel');
const catchAsync = require('./../utils/catchAsync');
const factory = require('./handlerFactory');

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
  await User.findOneAndUpdate(req.user.id, { active: false });

  req.status(204).json({
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

  // Super admin restrictions: cannot create platform_admin and is tenant-bound
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

  if (targetRole !== 'platform_admin') {
    // Require tenant when creating non-platform_admin
    const tenantForUser = requesterRole === 'super_admin' ? requesterTenantId : storeId;
    if (!tenantForUser) {
      return next(new AppError('storeId is required for non-platform_admin users', 400));
    }
    req.body.storeId = tenantForUser; // force tenant for super_admin
  }

  const user = await User.create({
    name,
    email,
    phone,
    storeId: targetRole === 'platform_admin' ? undefined : req.body.storeId,
    role: targetRole,
    password,
    passwordConfirm,
  });

  user.password = undefined;
  res.status(201).json({
    status: 'success',
    data: { user },
  });
});

exports.getUser = factory.getOne(User);
exports.getAllUsers = factory.getAll(User, { path: 'storeId', select: 'name' });

//Do NOT attempt to change passwords by this
exports.updateUser = factory.updateOne(User);
exports.deleteUser = factory.deleteOne(User);