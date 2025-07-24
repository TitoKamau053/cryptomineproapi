const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');

// Get recent transaction activities for dashboard live feed
router.get('/recent', transactionController.getRecentActivities);

module.exports = router;
