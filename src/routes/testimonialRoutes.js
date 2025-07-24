const express = require('express');
const router = express.Router();
const testimonialController = require('../controllers/testimonialController');

// Get success stories based on real user data
router.get('/success-stories', testimonialController.getSuccessStories);

module.exports = router;
