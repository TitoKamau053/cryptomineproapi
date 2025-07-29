const pool = require('../db');
const mpesa = require('../utils/mpesa');

const initiateDeposit = async (req, res) => {
  const userId = req.user.id;
  const { amount, phoneNumber } = req.body;
  
  if (!amount || !phoneNumber) {
    return res.status(400).json({ message: 'Amount and phone number are required' });
  }
  
  try {
    // Validate minimum deposit amount
    const minDeposit = 5; // Minimum deposit: 5 KES
    if (amount < minDeposit) {
      return res.status(400).json({ 
        message: `Minimum deposit amount is KES ${minDeposit}` 
      });
    }

    // First, initiate STK Push to get the CheckoutRequestID
    const accountReference = `Deposit_${userId}_${Date.now()}`;
    const transactionDesc = 'CryptoMinePro Deposit';

    console.log('Initiating STK Push:', {
      phoneNumber,
      amount,
      accountReference,
      transactionDesc,
      mpesaCallbackUrl: process.env.MPESA_STK_CALLBACK_URL
    });

    const stkResponse = await mpesa.stkPush(phoneNumber, amount, accountReference, transactionDesc);
    console.log('STK Push response:', stkResponse);

    // Check if STK Push was successful
    if (!stkResponse.CheckoutRequestID) {
      return res.status(500).json({ 
        message: 'Failed to initiate STK Push', 
        error: 'No CheckoutRequestID received from M-Pesa'
      });
    }

    // Now create deposit record using the CheckoutRequestID as transaction_id
    const transactionId = stkResponse.CheckoutRequestID;
    
    console.log('Creating deposit record with transaction ID:', transactionId);
    
    const [rows] = await pool.query('CALL sp_deposit(?, ?, ?, ?)', [
      userId,
      amount,
      'mpesa',
      transactionId
    ]);
    
    const transaction = rows[0][0];
    if (!transaction || !transaction.id) {
      console.error('Failed to create deposit record');
      return res.status(500).json({ message: 'Failed to create deposit record' });
    }

    console.log('Deposit record created successfully:', transaction);

    res.status(200).json({ 
      message: 'STK Push initiated and deposit record created', 
      stkResponse, 
      transaction_id: transactionId,
      deposit_id: transaction.id,
      note: "Please check your phone for the STK push prompt and complete the payment."
    });
    
  } catch (error) {
    console.error('Error initiating deposit:', error);
    
    // Send more helpful error message
    const errorMessage = error.response?.data?.errorMessage || 
                        error.response?.data?.ResultDesc || 
                        error.message;
    
    res.status(500).json({ 
      message: 'Failed to initiate deposit', 
      error: errorMessage,
      details: 'The M-Pesa STK Push service is experiencing issues. Please try again later.'
    });
  }
};

const mpesaDepositCallback = async (req, res) => {
  console.log('=== M-PESA DEPOSIT CALLBACK RECEIVED ===');
  console.log('Full callback data:', JSON.stringify(req.body, null, 2));
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  
  try {
    const callbackData = req.body;
    
    // Validate callback data structure
    if (!callbackData || !callbackData.Body || !callbackData.Body.stkCallback) {
      console.error('❌ Invalid callback data structure:', callbackData);
      return res.status(200).json({ 
        ResultCode: 1, 
        ResultDesc: 'Invalid callback data structure' 
      });
    }
    
    const stkCallback = callbackData.Body.stkCallback;
    const transactionId = stkCallback.CheckoutRequestID;
    const resultCode = stkCallback.ResultCode;
    const resultDesc = stkCallback.ResultDesc;
    
    console.log('📋 Processing callback:', {
      transactionId,
      resultCode,
      resultDesc,
      status: resultCode === 0 ? 'SUCCESS' : 'FAILED'
    });
    
    // Determine transaction status
    const status = resultCode === 0 ? 'completed' : 'failed';
    
    // Extract additional details if transaction was successful
    let mpesaReceipt = null;
    let phoneNumber = null;
    let amount = null;
    let transactionDate = null;
    
    if (resultCode === 0 && stkCallback.CallbackMetadata && stkCallback.CallbackMetadata.Item) {
      stkCallback.CallbackMetadata.Item.forEach(item => {
        switch (item.Name) {
          case 'MpesaReceiptNumber':
            mpesaReceipt = item.Value;
            break;
          case 'PhoneNumber':
            phoneNumber = item.Value;
            break;
          case 'Amount':
            amount = item.Value;
            break;
          case 'TransactionDate':
            transactionDate = item.Value;
            break;
        }
      });
      
      console.log('💰 Payment details extracted:', {
        mpesaReceipt,
        phoneNumber,
        amount,
        transactionDate
      });
    } else {
      console.log('❌ Transaction failed. Reason:', resultDesc);
    }

    // Update deposit status using stored procedure
    console.log('🔄 Updating deposit status in database...');
    
    try {
      const [updateResult] = await pool.query('CALL sp_update_deposit_status(?, ?)', [
        transactionId,
        status
      ]);
      
      console.log('✅ Deposit status update result:', updateResult);
      
      if (status === 'completed') {
        console.log(`🎉 SUCCESS: Deposit ${transactionId} completed and user balance updated!`);
        console.log(`Amount: KES ${amount}, Receipt: ${mpesaReceipt}`);
      } else {
        console.log(`⚠️ FAILED: Deposit ${transactionId} marked as failed`);
      }
      
    } catch (dbError) {
      console.error('❌ Database error updating deposit status:', dbError);
      // Still acknowledge to M-Pesa to prevent retries
      return res.status(200).json({ 
        ResultCode: 0, 
        ResultDesc: 'Received but database error occurred' 
      });
    }
    
    // Send successful acknowledgment to M-Pesa
    console.log('📤 Sending acknowledgment to M-Pesa');
    res.status(200).json({ 
      ResultCode: 0, 
      ResultDesc: 'Accepted and processed successfully' 
    });
    
  } catch (error) {
    console.error('💥 Critical error in deposit callback:', error);
    
    // Even on error, acknowledge to M-Pesa to prevent infinite retries
    res.status(200).json({ 
      ResultCode: 1, 
      ResultDesc: 'Error processing callback, but received' 
    });
  }
};

module.exports = {
  initiateDeposit,
  mpesaDepositCallback
};