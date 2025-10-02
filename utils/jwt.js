// utils/jwt.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

exports.signAccessToken = (userId) => {
  return jwt.sign(
    { sub: userId },                      // subject
    process.env.JWT_SECRET,               // same secret you already use
    { expiresIn: '15m' }                  // short lived (e.g., 10–30m)
  );
};

exports.signRefreshToken = (userId, jti) => {
  return jwt.sign(
    { sub: userId, jti },                 // include a unique token id (for rotation)
    process.env.JWT_REFRESH_SECRET,       // separate secret for refresh
    { expiresIn: '30d' }                  // longer lived (e.g., 7–30d)
  );
};

exports.verifyAccessToken = (token) =>
  jwt.verify(token, process.env.JWT_SECRET);

exports.verifyRefreshToken = (token) =>
  jwt.verify(token, process.env.JWT_REFRESH_SECRET);

exports.newJti = () => crypto.randomUUID();
