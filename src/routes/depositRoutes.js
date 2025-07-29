const express = require('express');
const router = express.Router();
const depositController = require('../controllers/depositController');

// User initiates deposit (STK Push) - requires authentication
router.post('/initiate', depositController.initiateDeposit);

// Remove the callback route from here since it's now in mpesaRoutes
// The callback needs to be public (no auth required)

module.exports = router;