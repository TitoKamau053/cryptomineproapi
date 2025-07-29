const express = require('express');
const router = express.Router();
const mpesaController = require('../controllers/mpesaController');
const depositController = require('../controllers/depositController'); // Add this import
const authMiddleware = require('../middleware/authMiddleware');

// STK Push request (user payment) - requires auth
router.post('/stk', authMiddleware.verifyToken, mpesaController.requestSTKPush);

// M-Pesa callbacks - NO AUTHENTICATION REQUIRED
router.post('/callback', mpesaController.mpesaCallback);
router.post('/stk-callback', mpesaController.stkCallback);

// ADD THIS - Deposit callback (public route)
router.post('/deposit-callback', depositController.mpesaDepositCallback);

// B2C payment request (admin payout) - requires auth
router.post('/b2c/payout', authMiddleware.verifyToken, mpesaController.b2cPayment);

// B2C callbacks - NO AUTHENTICATION REQUIRED
router.post('/b2c/result', mpesaController.b2cResultCallback);
router.post('/b2c/timeout', mpesaController.b2cTimeoutCallback);

module.exports = router;