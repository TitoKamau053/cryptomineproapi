const axios = require('axios');
const qs = require('qs');
const { formatPhoneForMpesa } = require('./phoneUtils');
require('dotenv').config();

const mpesaConfig = {
  consumerKey: process.env.MPESA_CONSUMER_KEY,
  consumerSecret: process.env.MPESA_CONSUMER_SECRET,
  shortcode: process.env.MPESA_SHORTCODE,
  passkey: process.env.MPESA_PASSKEY,
  environment: process.env.MPESA_ENV,
  callbackUrl: process.env.MPESA_STK_CALLBACK_URL, 
  initiatorName: process.env.MPESA_INITIATOR_NAME,
  securityCredential: process.env.MPESA_SECURITY_CREDENTIAL,
  b2cResultUrl: process.env.B2C_RESULT_URL,
  b2cTimeoutUrl: process.env.B2C_TIMEOUT_URL
};

const getAccessToken = async () => {
  const url = mpesaConfig.environment === 'production' 
    ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
    : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

  const auth = Buffer.from(`${mpesaConfig.consumerKey}:${mpesaConfig.consumerSecret}`).toString('base64');

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Basic ${auth}`
      }
    });
    return response.data.access_token;
  } catch (error) {
    console.error('Error getting M-Pesa access token:', error.response?.data || error.message);
    throw error;
  }
};

const stkPush = async (phoneNumber, amount, accountReference, transactionDesc) => {
  const accessToken = await getAccessToken();

  const url = mpesaConfig.environment === 'production' 
    ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
    : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
  const password = Buffer.from(mpesaConfig.shortcode + mpesaConfig.passkey + timestamp).toString('base64');

  // Format phone number for M-Pesa API
  const formattedPhone = formatPhoneForMpesa(phoneNumber);

  const data = {
    BusinessShortCode: mpesaConfig.shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: amount,
    PartyA: formattedPhone,
    PartyB: mpesaConfig.shortcode,
    PhoneNumber: formattedPhone,
    CallBackURL: mpesaConfig.callbackUrl,
    AccountReference: accountReference,
    TransactionDesc: transactionDesc
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error initiating M-Pesa STK Push:', error.response?.data || error.message);
    throw error;
  }
};

const b2cPayment = async (phoneNumber, amount, accountReference, transactionDesc) => {
  const accessToken = await getAccessToken();

  const url = mpesaConfig.environment === 'production'
    ? 'https://api.safaricom.co.ke/mpesa/b2c/v1/paymentrequest'
    : 'https://sandbox.safaricom.co.ke/mpesa/b2c/v1/paymentrequest';

  // Format phone number for M-Pesa API
  const formattedPhone = formatPhoneForMpesa(phoneNumber);

  const data = {
    InitiatorName: mpesaConfig.initiatorName,
    SecurityCredential: mpesaConfig.securityCredential,
    CommandID: 'BusinessPayment',
    Amount: amount,
    PartyA: mpesaConfig.shortcode,
    PartyB: formattedPhone,
    Remarks: transactionDesc || 'User Withdrawal',
    QueueTimeOutURL: mpesaConfig.b2cTimeoutUrl,
    ResultURL: mpesaConfig.b2cResultUrl,
    Occasion: accountReference || 'CryptoMinePro Withdrawal'
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error initiating M-Pesa B2C Payment:', error.response?.data || error.message);
    throw error;
  }
};

module.exports = {
  stkPush,
  b2cPayment
};