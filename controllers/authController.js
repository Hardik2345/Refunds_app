const { promisify } = require('util');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('./../models/userModel');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/appError');
const Email = require('./../utils/email');
const redis = require('../utils/redisClient'); // <-- you already have this

const { 
  signAccessToken, 
  signRefreshToken, 
  verifyAccessToken, 
  verifyRefreshToken,
  newJti
} = require('../utils/jwt');

// ---------- cookie helpers ----------
function setAuthCookies(req, res, { accessToken, refreshToken }) {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  // Access token usually lives in memory or a cookie; we'll cookie it for parity
  res.cookie('at', accessToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    maxAge: 15 * 60 * 1000, // 15m
  });
  res.cookie('rt', refreshToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30d
  });
}

function clearAuthCookies(res) {
  res.clearCookie('at');
  res.clearCookie('rt');
}

// ---------- core token issuance ----------
async function issueTokenPair(userId) {
  const jti = newJti();
  const accessToken = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId, jti);

  // Store RT in Redis with TTL = same as refresh token expiry (seconds)
  // Key: rt:<userId>:<jti> -> "1"
  const ttlSeconds = 30 * 24 * 60 * 60; // 30 days
  await redis.set(`rt:${userId}:${jti}`, '1', 'EX', ttlSeconds);

  return { accessToken, refreshToken, jti };
}

// ---------- existing helper kept (used by “login/signup” JSON response) ----------
const createSendToken = (user, statusCode, req, res, tokens) => {
  const { accessToken, refreshToken } = tokens;
  setAuthCookies(req, res, { accessToken, refreshToken });

  // optional: also send token in body for SPA (you can omit if you want only cookies)
  user.password = undefined;
  res.status(statusCode).json({
    status: 'success',
    token: accessToken,
    data: { user },
  });
};

// ---------- SIGNUP ----------
exports.signup = catchAsync(async (req, res, next) => {
  const newUser = await User.create({
    name: req.body.name,
    email: req.body.email,
    phone: req.body.phone,
    storeId: req.body.storeId,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
    role: req.body.role,
  });

  const url = `${req.protocol}://${req.get('host')}/me`;
  await new Email(newUser, url).sendWelcome();

  const tokens = await issueTokenPair(newUser._id);
  createSendToken(newUser, 201, req, res, tokens);
});

// ---------- LOGIN ----------
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

// ---------- LOGOUT (revoke current refresh token) ----------
exports.logout = catchAsync(async (req, res, next) => {
  // try to revoke current RT in Redis if present
  const rt = req.cookies?.rt;
  if (rt) {
    try {
      const payload = verifyRefreshToken(rt);
      await redis.del(`rt:${payload.sub}:${payload.jti}`);
    } catch (_) {
      // ignore invalid token on logout
    }
  }
  clearAuthCookies(res);
  res.status(200).json({ status: 'success' });
});

// ---------- PROTECT (unchanged behavior for access token) ----------
exports.protect = catchAsync(async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else  {
    token = req.cookies.at;
  } 

  if (!token)
    return next(new AppError('You are not logged in! Please login to get access.', 401));

  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

  const currentUser = await User.findById(decoded.sub || decoded.id);
  if (!currentUser)
    return next(new AppError('The user belonging to the token no longer exists', 401));

  if (currentUser.changedPasswordAfter(decoded.iat))
    return next(new AppError('User recently changed the password! Please login again', 401));

  req.user = currentUser;
  res.locals.user = currentUser;
  next();
});

// ---------- REFRESH (rotating refresh tokens) ----------
exports.refresh = catchAsync(async (req, res, next) => {
  const rt = req.cookies?.rt;
  if (!rt) return next(new AppError('Missing refresh token', 401));

  let payload;
  try {
    payload = verifyRefreshToken(rt);
  } catch (e) {
    return next(new AppError('Invalid refresh token', 401));
  }

  // Check Redis presence (token not revoked/rotated already)
  const key = `rt:${payload.sub}:${payload.jti}`;
  const exists = await redis.get(key);
  if (!exists) {
    // Reuse detected or already revoked
    clearAuthCookies(res);
    return next(new AppError('Refresh token is no longer valid', 401));
  }

  // Token is valid → rotate: delete old, issue new pair
  await redis.del(key);

  // Make sure user still exists and is active
  const user = await User.findById(payload.sub);
  if (!user) return next(new AppError('User no longer exists', 401));
  if (user.changedPasswordAfter(payload.iat)) {
    return next(new AppError('User recently changed password. Please login again.', 401));
  }

  const tokens = await issueTokenPair(user._id);
  setAuthCookies(req, res, tokens);

  res.status(200).json({
    status: 'success',
    token: tokens.accessToken,
  });
});
