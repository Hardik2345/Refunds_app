const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: false,
    },
    password: {
      type: String,
      required: true,
      minlength: 8,
      select: false, // don’t return in queries
    },
    passwordConfirm: {
      type: String,
      required: [true, 'Please confirm your password'],
      validate: {
        //This only works on CREATE and SAVE!!!
        validator: function (el) {
        return el === this.password;
      },
      message: 'Passwords are not the same!',
      },
    },
    role: {
      type: String,
      enum: ["super_admin", "refund_agent", "platform_admin", "user_admin"],
      default: "refund_agent",
    },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: function () {
        return this.role !== "platform_admin"; // Platform admins are global
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
    },
    passwordChangedAt: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,
  },
);
userSchema.pre('save', async function (next) {
  //Only run this function if password was modified
  if (!this.isModified('password')) return next();

  //Hash the password with cost of 12
  this.password = await bcrypt.hash(this.password, 12);

  //Delete the passwordConfirm field
  this.passwordConfirm = undefined;
  next();
});

userSchema.pre('save', function (next) {
  if (!this.isModified('password') || this.isNew) {
    return next();
  }

  this.passwordChangedAt = Date.now() - 1000;
  next();
});

userSchema.pre('save', function (next) {
  if (!this.isModified('password') || this.isNew) {
    this.passwordConfirm = undefined;
    next();
  } else {
    next();
  }
});

userSchema.pre(/^find/, function (next) {
  //this points to the current query
  this.find({ active: { $ne: false } });
  next();
});

//candidatePassword is the unhashed one
userSchema.methods.correctPassword = async function (
  candidatePassword,
  userPassword,
) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const chnagedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000);

    return JWTTimestamp < chnagedTimestamp;
  }

  return false;
};

userSchema.methods.createPasswordResetToken = function () {
  //Unencrypted token which will be sent to user via email
  const resetToken = crypto.randomBytes(32).toString('hex');

  //Encrypting the token for security
  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  this.passwordResetExpires = Date.now() + 10 * 60 * 1000;

  return resetToken;
};

// Index for faster lookups
userSchema.index({ email: 1, storeId: 1 });

module.exports = mongoose.model("User", userSchema);
