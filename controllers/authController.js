// controllers/authController.js
const { promisify } = require('util');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('./../models/userModel');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/appError');
const Email = require('./../utils/email');
const redis = require('../utils/redisClient');

// New JWT helpers (you said these exist in ../utils/jwt)
const {
  signAccessToken,     // (userId) -> short-lived JWT (e.g. 15m)
  signRefreshToken,    // (userId, jti) -> long-lived JWT (e.g. 30d)
  verifyAccessToken,   // (token) -> payload (throws on invalid)
  verifyRefreshToken,  // (token) -> payload (throws on invalid)
  newJti               // () -> random string
} = require('../utils/jwt');

// ---------------- Cookie utilities ----------------
function setAuthCookies(req, res, { accessToken, refreshToken }) {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';

  // NOTE: If FE & BE are on different domains, use sameSite:'none' + secure:true
  res.cookie('at', accessToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    maxAge: 15 * 60 * 1000, // 15 minutes
  });

  res.cookie('rt', refreshToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
}

function clearAuthCookies(res) {
  res.clearCookie('at');
  res.clearCookie('rt');
  // backward-compat for old cookie name if it exists
  res.clearCookie('jwt');
}

// ---------------- Token issuance (with Redis) ----------------
async function issueTokenPair(userId) {
  const jti = newJti();
  const accessToken = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId, jti);

  // Store the refresh token “jti” in Redis so we can rotate/revoke
  // Key: rt:<userId>:<jti> -> "1"
  const ttlSeconds = 30 * 24 * 60 * 60; // 30 days
  await redis.set(`rt:${userId}:${jti}`, '1', 'EX', ttlSeconds);

  return { accessToken, refreshToken, jti };
}

// ---------------- Old-style JSON response, now using new tokens ----------------
const createSendToken = (user, statusCode, req, res, tokens) => {
  const { accessToken, refreshToken } = tokens;
  setAuthCookies(req, res, { accessToken, refreshToken });

  user.password = undefined;
  res.status(statusCode).json({
    status: 'success',
    token: accessToken, // keeps old API shape if your FE expects it
    data: { user },
  });
};

// ---------------- SIGNUP ----------------
exports.signup = catchAsync(async (req, res, next) => {
  const newUser = await User.create({
    name:     req.body.name,
    email:    req.body.email,
    phone:    req.body.phone,
    storeId:  req.body.storeId,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
    role:     req.body.role,
  });

  // Optional welcome email
  const url = `${req.protocol}://${req.get('host')}/me`;
  await new Email(newUser, url).sendWelcome();

  const tokens = await issueTokenPair(newUser._id);
  createSendToken(newUser, 201, req, res, tokens);
});

// ---------------- LOGIN ----------------
exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password)
    return next(new AppError('Please provide email and password', 400));

  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.correctPassword(password, user.password)))
    return next(new AppError('Incorrect email or password', 401));

  const tokens = await issueTokenPair(user._id);
  createSendToken(user, 200, req, res, tokens);
});

// ---------------- LOGOUT (revoke current refresh token) ----------------
exports.logout = catchAsync(async (req, res, next) => {
  // If refresh token in cookie, revoke it in Redis
  const rt = req.cookies?.rt;
  if (rt) {
    try {
      const payload = verifyRefreshToken(rt); // { sub, jti, iat, exp }
      await redis.del(`rt:${payload.sub}:${payload.jti}`);
    } catch (_) {
      // ignore invalid token on logout
    }
  }
  clearAuthCookies(res);
  res.status(200).json({ status: 'success' });
});

// ---------------- PROTECT (access-token required) ----------------
exports.protect = catchAsync(async (req, res, next) => {
  let token;

  // 1) Allow Authorization: Bearer <token>
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else {
    // 2) Else take from new cookie "at", else fallback to old "jwt"
    token = req.cookies?.at || req.cookies?.jwt;
  }

  if (!token)
    return next(new AppError('You are not logged in! Please login to get access.', 401));

  // If you want to use the new verifyAccessToken helper:
  const decoded = verifyAccessToken(token);
  // but to preserve your old behavior (promisify verify), use:
  // const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

  // decoded.sub (new format) or decoded.id (old format)
  const userId = decoded.sub || decoded.id;
  const currentUser = await User.findById(userId);
  if (!currentUser)
    return next(new AppError('The user belonging to the token no longer exists', 401));

  if (currentUser.changedPasswordAfter(decoded.iat))
    return next(new AppError('User recently changed the password! Please login again', 401));

  req.user = currentUser;
  res.locals.user = currentUser;
  next();
});

// ---------------- isLoggedIn (for rendered pages) ----------------
exports.isLoggedIn = async (req, res, next) => {
  // Check new cookie first, then fallback to old "jwt"
  const raw = req.cookies?.at || req.cookies?.jwt;
  if (!raw) return next();

  try {
    const decoded = await promisify(jwt.verify)(raw, process.env.JWT_SECRET);

    const currentUser = await User.findById(decoded.sub || decoded.id);
    if (!currentUser) return next();

    if (currentUser.changedPasswordAfter(decoded.iat)) return next();

    res.locals.user = currentUser;
    return next();
  } catch (_) {
    return next();
  }
};

// ---------------- Unauthorized access prevention to login when already logged in ----------------
exports.unauthorizedAccessToLoginRoute = catchAsync(async (req, res, next) => {
  if (res.locals.user) {
    return next(
      new AppError(
        'Sorry! You cannot access the login route while you are already logged in!',
        400
      )
    );
  }
  next();
});

// ---------------- Role-based authorization ----------------
exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    // Your users use `role` (singular). Keep as-is.
    if (!roles.includes(req.user.role)) {
      return next(new AppError('You do not have permission to perform this action', 403));
    }
    next();
  };
};

// ---------------- Forgot Password ----------------
exports.forgotPassword = catchAsync(async (req, res, next) => {
  // 1) Get user
  const user = await User.findOne({ email: req.body.email });
  if (!user)
    return next(new AppError('There is no user with that email address', 404));

  // 2) Generate token
  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  try {
    const resetURL = `${req.protocol}://${req.get('host')}/api/v1/users/resetPassword/${resetToken}`;
    await new Email(user, resetURL).sendPasswordReset();

    res.status(200).json({
      status: 'success',
      message: 'Token sent to email',
    });
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

    return next(new AppError('There was an error sending the email. Try again later!', 500));
  }
});

// ---------------- Reset Password ----------------
exports.resetPasssword = catchAsync(async (req, res, next) => {
  // 1) Hash token and find user
  const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gte: Date.now() },
  });

  if (!user) return next(new AppError('token is invalid or expired', 400));

  // 2) Update password
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  // 3) Issue new token pair after reset
  const tokens = await issueTokenPair(user._id);
  createSendToken(user, 200, req, res, tokens);
});

// ---------------- Update Password (logged-in) ----------------
exports.updatePassword = catchAsync(async (req, res, next) => {
  // 1) Get user
  const user = await User.findById(req.user.id).select('+password');

  // 2) Check current password
  if (!(await user.correctPassword(req.body.passwordCurrent, user.password))) {
    return next(new AppError('Your current password is wrong', 401));
  }

  // 3) Set new password
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  await user.save();

  // 4) Issue fresh tokens
  const tokens = await issueTokenPair(user._id);
  createSendToken(user, 200, req, res, tokens);
});

// ---------------- Refresh (rotating refresh tokens) ----------------
exports.refresh = catchAsync(async (req, res, next) => {
  const rt = req.cookies?.rt;
  if (!rt) return next(new AppError('Missing refresh token', 401));

  let payload;
  try {
    payload = verifyRefreshToken(rt); // { sub, jti, iat, exp }
  } catch (e) {
    return next(new AppError('Invalid refresh token', 401));
  }

  // Ensure token is still valid in Redis (not revoked/rotated)
  const key = `rt:${payload.sub}:${payload.jti}`;
  const exists = await redis.get(key);
  if (!exists) {
    clearAuthCookies(res);
    return next(new AppError('Refresh token is no longer valid', 401));
  }

  // Rotate: revoke old, issue new
  await redis.del(key);

  // Confirm the user still exists and is valid
  const user = await User.findById(payload.sub);
  if (!user) return next(new AppError('User no longer exists', 401));
  if (user.changedPasswordAfter(payload.iat)) {
    return next(new AppError('User recently changed password. Please login again.', 401));
  }

  const tokens = await issueTokenPair(user._id);
  setAuthCookies(req, res, tokens);

  res.status(200).json({
    status: 'success',
    token: tokens.accessToken, // keep old API field
  });
});
