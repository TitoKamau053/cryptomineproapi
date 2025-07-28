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
  // Validate required configuration
  if (!mpesaConfig.consumerKey || !mpesaConfig.consumerSecret) {
    console.error('Missing M-Pesa credentials: consumerKey or consumerSecret not set');
    throw new Error('M-Pesa credentials not properly configured');
  }

  const url = mpesaConfig.environment === 'production' 
    ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
    : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

  const auth = Buffer.from(`${mpesaConfig.consumerKey}:${mpesaConfig.consumerSecret}`).toString('base64');

  try {
    console.log(`Getting M-Pesa access token from ${mpesaConfig.environment} environment...`);
    console.log(`Using consumer key: ${mpesaConfig.consumerKey.substring(0, 5)}...`);
    console.log(`API URL: ${url}`);
    
    const response = await axios.get(url, {
      headers: {
        Authorization: `Basic ${auth}`
      }
    });
    
    if (!response.data || !response.data.access_token) {
      console.error('Invalid M-Pesa access token response:', response.data);
      throw new Error('Failed to get valid access token from M-Pesa');
    }
    
    console.log('Successfully obtained access token');
    return response.data.access_token;
  } catch (error) {
    console.error('Error getting M-Pesa access token:', error.message);
    if (error.response) {
      console.error('M-Pesa API response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    }
    throw new Error(`Failed to get M-Pesa access token: ${error.message}`);
  }
};

const stkPush = async (phoneNumber, amount, accountReference, transactionDesc) => {
  console.log('Starting STK Push process for:', { phoneNumber, amount, accountReference });
  
  try {
    const accessToken = await getAccessToken();
    console.log('Successfully obtained M-Pesa access token');

    const url = mpesaConfig.environment === 'production' 
      ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
      : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

    const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
    const password = Buffer.from(mpesaConfig.shortcode + mpesaConfig.passkey + timestamp).toString('base64');

    // Format phone number for M-Pesa API
    const formattedPhone = formatPhoneForMpesa(phoneNumber);
    console.log('Formatted phone number:', formattedPhone);

    // Check callback URL is properly configured
    if (!mpesaConfig.callbackUrl || 
        mpesaConfig.callbackUrl.includes('ngrok') && 
        !mpesaConfig.callbackUrl.includes('online')) {
      console.warn('WARNING: M-Pesa callback URL might be an expired ngrok tunnel:', mpesaConfig.callbackUrl);
    }

    // In sandbox, we must always use "CustomerPayBillOnline" 
    // For production, we should use the appropriate type based on the shortcode
    let transactionType = 'CustomerPayBillOnline'; // Default for sandbox and paybill numbers
    
    // Only use the logic to determine transaction type in production
    if (mpesaConfig.environment === 'production') {
      // Check if it's a till number or paybill based on shortcode length
      if (mpesaConfig.shortcode.toString().length <= 6) {
        transactionType = 'CustomerBuyGoodsOnline'; // Till number (usually 6 digits or less)
      }
    }
      
    console.log(`Using transaction type: ${transactionType} for shortcode: ${mpesaConfig.shortcode} in ${mpesaConfig.environment} environment`);
    
    const data = {
      BusinessShortCode: mpesaConfig.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: transactionType,
      Amount: amount,
      PartyA: formattedPhone,
      PartyB: mpesaConfig.shortcode,
      PhoneNumber: formattedPhone,
      CallBackURL: mpesaConfig.callbackUrl,
      AccountReference: accountReference,
      TransactionDesc: transactionDesc
    };

    // Additional validation
    console.log('STK Push Configuration:', {
      environment: mpesaConfig.environment,
      shortcode: mpesaConfig.shortcode,
      callbackUrl: mpesaConfig.callbackUrl,
      phoneNumber: phoneNumber,
      formattedPhone: formattedPhone
    });
    
    console.log('STK Push payload:', JSON.stringify(data));

    try {
      const response = await axios.post(url, data, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      console.log('STK Push request successful:', response.data);
      return response.data;
    } catch (error) {
      console.error('Error initiating M-Pesa STK Push:', error.response?.data || error.message);
      if (error.response) {
        console.error('M-Pesa API error details:', {
          status: error.response.status,
          data: error.response.data
        });
      }
      throw error;
    }
  } catch (error) {
    console.error('Error in STK Push process:', error.message);
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
  getAccessToken,
  stkPush,
  b2cPayment
};