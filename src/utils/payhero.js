const axios = require('axios');
const dotenv = require('dotenv');
const logger = require('./logger'); // If you have a logger utility, else use console

dotenv.config();


const PAYHERO_API_KEY = process.env.PAYHERO_API_KEY;
const PAYHERO_API_URL = process.env.PAYHERO_API_URL || 'https://api.payhero.co.ke/api/payments/initiate';
const PAYHERO_CHANNEL_ID = process.env.PAYHERO_CHANNEL_ID;
const PAYHERO_CALLBACK_URL = process.env.PAYHERO_CALLBACK_URL;

/**
 * Initiate PayHero STK Push

/**
 * Initiate PayHero STK Push
 * @param {string} phoneNumber - Customer phone number (format: 2547XXXXXXXX)
 * @param {number} amount - Amount to charge
 * @param {string} transactionId - Unique transaction ID (used as client_reference)
 * @param {string} description - Description for the payment
 * @returns {Promise<object>} - PayHero API response
 */
async function stkPush(phoneNumber, amount, transactionId, description) {
  const payload = {
    phone: phoneNumber,
    amount: amount,
    client_reference: transactionId, // for reconciliation
    description: description,
    channel_id: PAYHERO_CHANNEL_ID,
    callback_url: PAYHERO_CALLBACK_URL
  };

  const headers = {
    'Authorization': `Bearer ${PAYHERO_API_KEY}`,
    'Content-Type': 'application/json'
  };

  logger && logger.info ? logger.info('PayHero STK Push Request:', payload) : console.log('PayHero STK Push Request:', payload);

  try {
    const response = await axios.post(PAYHERO_API_URL, payload, { headers });
    logger && logger.info ? logger.info('PayHero STK Push Response:', response.data) : console.log('PayHero STK Push Response:', response.data);
    return response.data;
  } catch (error) {
    logger && logger.error ? logger.error('PayHero STK Push Error:', error.response ? error.response.data : error.message) : console.error('PayHero STK Push Error:', error.response ? error.response.data : error.message);
    throw error;
  }
}

module.exports = {
  stkPush
};
