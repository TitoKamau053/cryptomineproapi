const pool = require('../db');
const axios = require('axios');
const moment = require('moment');
const { formatPhoneForMpesa, formatPhoneForDisplay } = require('../utils/phoneUtils');
require('dotenv').config();

// Get M-Pesa Access Token
async function getAccessToken() {
  const base64 = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
  const url = process.env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
    : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

  const response = await axios.get(url, {
    headers: {
      Authorization: `Basic ${base64}`
    }
  });

  return response.data.access_token;
}

// === STK PUSH (User Deposit) ===
async function requestSTKPush(req, res) {
  const { phone, amount, accountRef = process.env.MPESA_ACCOUNT_REFERENCE } = req.body;
  try {
    const token = await getAccessToken();
    const timestamp = moment().format('YYYYMMDDHHmmss');
    const password = Buffer.from(process.env.MPESA_SHORTCODE + process.env.MPESA_PASSKEY + timestamp).toString('base64');

    // Format phone number for M-Pesa API
    const formattedPhone = formatPhoneForMpesa(phone);

    const payload = {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: formattedPhone,
      PartyB: process.env.MPESA_SHORTCODE,
      PhoneNumber: formattedPhone,
      CallBackURL: process.env.MPESA_STK_CALLBACK_URL,
      AccountReference: accountRef,
      TransactionDesc: process.env.MPESA_TRANSACTION_DESC || "Deposit"
    };

    const url = process.env.MPESA_ENV === 'production'
      ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
      : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

    const response = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${token}` }
    });

    // Save initial transaction
    await pool.query(`
      INSERT INTO mpesa_transactions (phone, amount, status, checkoutRequestId)
      VALUES (?, ?, ?, ?)
    `, [formattedPhone, amount, 'PENDING', response.data.CheckoutRequestID]);

    res.json(response.data);
  } catch (error) {
    console.error('STK Push Error:', error.response?.data || error.message);
    res.status(500).json({ message: 'Failed to initiate STK Push' });
  }
}

// === STK CALLBACK HANDLER ===
async function stkCallback(req, res) {
  const callbackData = req.body;
  console.log('Received M-Pesa STK Callback:', JSON.stringify(callbackData, null, 2));

  try {
    // Check if callback has the expected structure
    if (!callbackData.Body || !callbackData.Body.stkCallback) {
      console.error('Invalid callback structure:', callbackData);
      return res.json({ ResultCode: 1, ResultDesc: "Invalid callback structure" });
    }

    const callback = callbackData.Body.stkCallback;
    const status = callback.ResultCode === 0 ? 'SUCCESS' : 'FAILED';
    const checkoutRequestId = callback.CheckoutRequestID;

    // Extract transaction details from callback metadata
    let mpesaReceipt = null;
    let phone = null;
    let amount = null;
    let transactionDate = null;

    if (callback.CallbackMetadata && callback.CallbackMetadata.Item) {
      callback.CallbackMetadata.Item.forEach(item => {
        switch (item.Name) {
          case 'MpesaReceiptNumber':
            mpesaReceipt = item.Value;
            break;
          case 'PhoneNumber':
            phone = item.Value;
            break;
          case 'Amount':
            amount = item.Value;
            break;
          case 'TransactionDate':
            transactionDate = item.Value;
            break;
        }
      });
    }

    // Update transaction in database
    await pool.query(`
      UPDATE mpesa_transactions
      SET status = ?, receipt = ?, phone = ?, amount = ?
      WHERE checkoutRequestId = ?
    `, [status, mpesaReceipt, phone, amount, checkoutRequestId]);

    console.log(`Transaction ${checkoutRequestId} updated with status: ${status}`);

    // If successful, credit user's wallet (you may implement this logic)
    if (status === 'SUCCESS' && amount && phone) {
      console.log(`Payment of KES ${amount} from ${phone} was successful. Receipt: ${mpesaReceipt}`);
      // TODO: Credit user wallet logic here
    }

    // Send M-Pesa acknowledgment as per the guide
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (error) {
    console.error('STK Callback Error:', error);
    // Even on error, we should acknowledge to M-Pesa to prevent retries
    res.json({ ResultCode: 1, ResultDesc: "Error processing callback" });
  }
}

// === B2C PAYMENT (Withdraw to User) ===
async function b2cPayment(req, res) {
  const { phone, amount } = req.body;
  try {
    const token = await getAccessToken();

    // Format phone number for M-Pesa API
    const formattedPhone = formatPhoneForMpesa(phone);

    const payload = {
      InitiatorName: process.env.MPESA_INITIATOR_NAME,
      SecurityCredential: process.env.MPESA_SECURITY_CREDENTIAL,
      CommandID: "BusinessPayment",
      Amount: amount,
      PartyA: process.env.MPESA_SHORTCODE,
      PartyB: formattedPhone,
      Remarks: "User Withdrawal",
      QueueTimeOutURL: process.env.B2C_TIMEOUT_URL,
      ResultURL: process.env.B2C_RESULT_URL,
      Occasion: "CryptoMinePro Withdrawal"
    };

    const url = process.env.MPESA_ENV === 'production'
      ? 'https://api.safaricom.co.ke/mpesa/b2c/v1/paymentrequest'
      : 'https://sandbox.safaricom.co.ke/mpesa/b2c/v1/paymentrequest';

    const response = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${token}` }
    });

    await pool.query(`
      INSERT INTO mpesa_payouts (phone, amount, status)
      VALUES (?, ?, ?)
    `, [formattedPhone, amount, 'PENDING']);

    res.json(response.data);
  } catch (error) {
    console.error('B2C Payment Error:', error.response?.data || error.message);
    res.status(500).json({ message: 'Failed to initiate B2C payment' });
  }
}

// === B2C CALLBACK HANDLER ===
async function b2cResultCallback(req, res) {
  const callbackData = req.body;
  console.log('Received M-Pesa B2C Result Callback:', JSON.stringify(callbackData, null, 2));

  try {
    // Check if callback has the expected structure
    if (!callbackData.Result) {
      console.error('Invalid B2C callback structure:', callbackData);
      return res.json({ ResultCode: 1, ResultDesc: "Invalid callback structure" });
    }

    const result = callbackData.Result;
    const status = result.ResultCode === 0 ? 'SUCCESS' : 'FAILED';
    const transactionId = result.TransactionID;
    const conversationId = result.ConversationID;
    const originatorConversationId = result.OriginatorConversationID;

    // Extract transaction details from result parameters
    let phone = null;
    let amount = null;
    let transactionReceipt = null;
    let recipientInfo = null;

    if (result.ResultParameters && result.ResultParameters.ResultParameter) {
      result.ResultParameters.ResultParameter.forEach(param => {
        switch (param.Key) {
          case 'TransactionReceipt':
            transactionReceipt = param.Value;
            break;
          case 'TransactionAmount':
            amount = param.Value;
            break;
          case 'ReceiverPartyPublicName':
            phone = param.Value;
            break;
          case 'B2CWorkingAccountAvailableFunds':
            // Available balance after transaction
            break;
        }
      });
    }

    // Update payout record in database
    await pool.query(`
      UPDATE mpesa_payouts
      SET status = ?, transactionId = ?
      WHERE phone = ? AND amount = ? AND status = 'PENDING'
      ORDER BY created_at DESC
      LIMIT 1
    `, [status, transactionId, phone, amount]);

    console.log(`B2C Transaction ${transactionId} completed with status: ${status}`);

    if (status === 'SUCCESS') {
      console.log(`Payout of KES ${amount} to ${phone} was successful. Receipt: ${transactionReceipt}`);
    } else {
      console.log(`Payout failed. Error: ${result.ResultDesc}`);
    }

    // Send M-Pesa acknowledgment as per the guide
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (error) {
    console.error('B2C Result Callback Error:', error);
    // Even on error, we should acknowledge to M-Pesa to prevent retries
    res.json({ ResultCode: 1, ResultDesc: "Error processing callback" });
  }
}

// === GENERIC M-PESA CALLBACK HANDLER (as per guide) ===
async function mpesaCallback(req, res) {
  const callbackData = req.body;
  console.log('Received M-Pesa Callback:', JSON.stringify(callbackData, null, 2));

  try {
    // Save callback data to database for audit/debugging
    await pool.query(`
      INSERT INTO mpesa_callbacks (callback_data, callback_type, processed_at)
      VALUES (?, ?, NOW())
    `, [JSON.stringify(callbackData), 'generic']);

    // Process transaction based on callback type
    if (callbackData.Body && callbackData.Body.stkCallback) {
      // This is an STK Push callback - redirect to STK handler
      return await stkCallback(req, res);
    } else if (callbackData.Result) {
      // This could be a B2C result callback
      return await b2cResultCallback(req, res);
    } else {
      console.log('Unknown callback type, but acknowledging to M-Pesa');
    }

    // Send M-Pesa acknowledgment as per the guide
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (error) {
    console.error('Generic M-Pesa Callback Error:', error);
    
    // Even on error, we should acknowledge to M-Pesa to prevent retries
    res.json({ ResultCode: 1, ResultDesc: "Error processing callback" });
  }
}

// === B2C TIMEOUT HANDLER ===
function b2cTimeoutCallback(req, res) {
  const callbackData = req.body;
  console.log('Received M-Pesa B2C Timeout Callback:', JSON.stringify(callbackData, null, 2));
  
  try {
    // Handle timeout - you might want to mark transactions as timed out
    if (callbackData.Result) {
      const result = callbackData.Result;
      console.warn(`B2C Transaction timed out: ${result.OriginatorConversationID}`);
      
      // You could update the database to mark as timed out
      // await pool.query(`UPDATE mpesa_payouts SET status = 'TIMEOUT' WHERE conversationId = ?`, [result.OriginatorConversationID]);
    }

    // Send M-Pesa acknowledgment as per the guide
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (error) {
    console.error('B2C Timeout Callback Error:', error);
    // Even on error, we should acknowledge to M-Pesa
    res.json({ ResultCode: 1, ResultDesc: "Error processing timeout callback" });
  }
}

module.exports = {
  requestSTKPush,
  stkCallback,
  b2cPayment,
  b2cResultCallback,
  b2cTimeoutCallback,
  mpesaCallback
};
