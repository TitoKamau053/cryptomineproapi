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

    // Generate a unique transaction ID (e.g., UUID or timestamp-based)
    const transactionId = `tx_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    // Call stored procedure to create deposit record and get deposit details
    const [rows] = await pool.query('CALL sp_deposit(?, ?, ?, ?)', [
      userId,
      amount,
      'mpesa', // Assuming method is always 'mpesa' here
      transactionId
    ]);
    const transaction = rows[0][0];
    if (!transaction || !transaction.id) {
      return res.status(500).json({ message: 'Failed to initiate deposit transaction' });
    }

    // Initiate STK Push
    const accountReference = `Deposit_${userId}_${transaction.id}`;
    const transactionDesc = 'CryptoMinePro Deposit';

    console.log('Initiating STK Push:', {
      phoneNumber,
      amount,
      accountReference,
      transactionDesc,
      mpesaCallbackUrl: process.env.MPESA_STK_CALLBACK_URL
    });

    const response = await mpesa.stkPush(phoneNumber, amount, accountReference, transactionDesc);
    
    console.log('STK Push response:', response);

    res.status(200).json({ 
      message: 'STK Push initiated', 
      response, 
      transaction_id: transaction.id,
      note: "Please check your phone for the STK push prompt."
    });
  } catch (error) {
    console.error('Error initiating deposit:', error);
    
    // Send more helpful error message
    const errorMessage = error.response?.data?.errorMessage || error.message;
    res.status(500).json({ 
      message: 'Failed to initiate deposit', 
      error: errorMessage,
      details: 'The M-Pesa STK Push service is experiencing issues. Please try again later.'
    });
  }
};

const mpesaDepositCallback = async (req, res) => {
  console.log('Received M-Pesa deposit callback:', JSON.stringify(req.body, null, 2));
  
  try {
    const callbackData = req.body;
    
    // Validate callback data structure
    if (!callbackData || !callbackData.Body || !callbackData.Body.stkCallback) {
      console.error('Invalid callback data structure:', callbackData);
      return res.status(200).json({ message: 'Invalid callback data structure' });
    }
    
    // Extract transaction id and status from callbackData according to M-Pesa API spec
    const transactionId = callbackData.Body.stkCallback.CheckoutRequestID;
    const resultCode = callbackData.Body.stkCallback.ResultCode;
    const status = resultCode === 0 ? 'completed' : 'failed';
    
    console.log(`Processing deposit callback - Transaction ID: ${transactionId}, Result Code: ${resultCode}, Status: ${status}`);
    
    // Extract receipt number and other details if available
    let mpesaReceipt = null;
    let phoneNumber = null;
    let amount = null;
    
    if (resultCode === 0 && callbackData.Body.stkCallback.CallbackMetadata && callbackData.Body.stkCallback.CallbackMetadata.Item) {
      callbackData.Body.stkCallback.CallbackMetadata.Item.forEach(item => {
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
        }
      });
      
      console.log('Extracted payment details:', {
        mpesaReceipt,
        phoneNumber,
        amount
      });
    } else if (resultCode !== 0) {
      console.log('M-Pesa transaction failed with reason:', callbackData.Body.stkCallback.ResultDesc);
    }

    // Update deposit status in database
    await pool.query('CALL sp_update_deposit_status(?, ?)', [
      transactionId,
      status
    ]);

    console.log(`Successfully updated deposit status for transaction ${transactionId} to ${status}`);

    // If deposit is successful, update user balance
    if (status === 'completed' && amount && transactionId) {
      // Find the user_id for this deposit
      const [depositRows] = await pool.query('SELECT user_id FROM deposits WHERE transaction_id = ? LIMIT 1', [transactionId]);
      if (depositRows.length > 0) {
        const userId = depositRows[0].user_id;
        await pool.query('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, userId]);
        console.log(`User ${userId} balance updated by ${amount} after successful deposit.`);
      } else {
        console.warn(`No deposit record found for transaction_id: ${transactionId}`);
      }
    }

    res.status(200).json({ message: 'Deposit status updated' });
  } catch (error) {
    console.error('Error updating deposit status:', error);
    // Still return 200 to M-Pesa to acknowledge receipt
    res.status(200).json({ message: 'Error processing callback, but received' });
  }
};

module.exports = {
  initiateDeposit,
  mpesaDepositCallback
};
