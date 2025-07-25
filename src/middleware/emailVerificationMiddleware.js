const checkEmailVerification = (req, res, next) => {
  // Skip email verification check for admins
  if (req.user.role === 'admin') {
    return next();
  }

  // Check if email is verified
  if (!req.user.email_verified) {
    return res.status(403).json({ 
      message: 'Email not verified. Please verify your email before accessing this feature.' 
    });
  }

  next();
};

module.exports = { checkEmailVerification };
