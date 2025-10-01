// middlewares/errorHandler.js
const AppError = require('../utils/appError');

const handleCastErrorDB = (err) => {
  const value = typeof err.value === 'object' ? JSON.stringify(err.value) : String(err.value);
  const message = `Invalid ${err.path}: ${value}`;
  return new AppError(message, 400);
};

const handleDuplicateFieldsDB = (err) => {
  // Mongo duplicate key error (code 11000); prefer keyValue
  const kv = err.keyValue || {};
  const field = Object.keys(kv)[0] || 'field';
  const value = kv[field];
  const message = `Duplicate value for "${field}": ${JSON.stringify(value)}. Please use another value.`;
  return new AppError(message, 400);
};

const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors || {}).map((e) => e.message || String(e));
  const message = `Invalid input data. ${errors.join(' ')}`;
  return new AppError(message, 400);
};

const handleJWTError = () => new AppError('Invalid token. Please log in again.', 401);
const handleJWTExpiredError = () => new AppError('Your token has expired. Please log in again.', 401);

const sendErrorDev = (err, req, res) => {
  const statusCode = err.statusCode || 500;
  if (req.originalUrl?.startsWith('/api')) {
    return res.status(statusCode).json({
      status: err.status || 'error',
      message: err.message,
      stack: err.stack,
      error: err,
    });
  }
  // If you actually render views, swap this to render(...)
  return res.status(statusCode).json({
    title: 'Something went wrong!',
    msg: err.message,
    stack: err.stack,
  });
};

const sendErrorProd = (err, req, res) => {
  const statusCode = err.statusCode || 500;
  if (req.originalUrl?.startsWith('/api')) {
    if (err.isOperational) {
      return res.status(statusCode).json({
        status: err.status || 'error',
        message: err.message,
      });
    }
    // Programming or unknown error
    // eslint-disable-next-line no-console
    console.error('ERROR 💥', err);
    return res.status(500).json({
      status: 'error',
      message: 'Something went very wrong.',
    });
  }

  // “Rendered website” branch; adjust if you use templates
  if (err.isOperational) {
    return res.status(statusCode).json({
      title: 'Something went wrong!',
      msg: err.message,
    });
  }
  // eslint-disable-next-line no-console
  console.error('ERROR 💥', err);
  return res.status(500).json({
    title: 'Something went wrong!',
    msg: 'Please try again later.',
  });
};

module.exports = (err, req, res, _next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (process.env.NODE_ENV === 'development') {
    return sendErrorDev(err, req, res);
  }

  // production: normalize and map known errors
  let error = err;
  // Ensure message/name preserved when error is cloned by other middlewares
  error.message = error.message || err.message;
  error.name = error.name || err.name;

  if (error.name === 'CastError') error = handleCastErrorDB(error);
  if (error.code === 11000) error = handleDuplicateFieldsDB(error);
  if (error.name === 'ValidationError') error = handleValidationErrorDB(error);
  if (error.name === 'JsonWebTokenError') error = handleJWTError();
  if (error.name === 'TokenExpiredError') error = handleJWTExpiredError();

  return sendErrorProd(error, req, res);
};
