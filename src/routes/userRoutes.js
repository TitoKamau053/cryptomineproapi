const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware');

// User registration
router.post('/register', userController.registerUser);

// User login
router.post('/login', userController.loginUser);

// Email verification
router.get('/verify-email', userController.verifyEmail);

// Resend verification email
router.post('/resend-verification', userController.resendVerificationEmail);

// Check email verification status
router.get('/verification-status', userController.checkEmailVerificationStatus);

// Get user profile (protected)
router.get('/profile', authMiddleware.verifyToken, userController.getUserProfile);

module.exports = router;
