const express = require('express');
const router = express.Router();
const mpesaController = require('../controllers/mpesaController');
const authMiddleware = require('../middleware/authMiddleware');

// STK Push request (user payment)
router.post('/stk', authMiddleware.verifyToken, mpesaController.requestSTKPush);

// Generic M-Pesa callback URL (as per guide)
router.post('/callback', mpesaController.mpesaCallback);

// STK Push specific callback URL
router.post('/stk-callback', mpesaController.stkCallback);

// B2C payment request (admin payout)
router.post('/b2c/payout', authMiddleware.verifyToken, mpesaController.b2cPayment);

// B2C result callback URL
router.post('/b2c/result', mpesaController.b2cResultCallback);

// B2C timeout callback URL
router.post('/b2c/timeout', mpesaController.b2cTimeoutCallback);

module.exports = router;
