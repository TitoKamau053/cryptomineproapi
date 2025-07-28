// EMAIL VERIFICATION DISABLED - This middleware is no longer used
// Users are automatically verified upon registration
const checkEmailVerification = (req, res, next) => {
  // Skip email verification - all users are considered verified
  next();
};

module.exports = { checkEmailVerification };
