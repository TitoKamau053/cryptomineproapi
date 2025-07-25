const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware');

// Public routes
router.post('/register', userController.register);
router.post('/login', userController.login);
router.get('/verify-email', userController.verifyEmail);
router.post('/resend-verification', userController.resendVerification);
router.get('/verification-status', userController.getVerificationStatus);

// Protected routes
router.get('/profile', authMiddleware.verifyToken, userController.getUserProfile);

module.exports = router;
