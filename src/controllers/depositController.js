const pool = require('../db');
const mpesa = require('../utils/mpesa');

const initiateDeposit = async (req, res) => {
  const userId = req.user.id;
  const { amount, phoneNumber } = req.body;
  if (!amount || !phoneNumber) {
    return res.status(400).json({ message: 'Amount and phone number are required' });
  }
  try {
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

    const response = await mpesa.stkPush(phoneNumber, amount, accountReference, transactionDesc);

    res.status(200).json({ message: 'STK Push initiated', response, transaction_id: transaction.id });
  } catch (error) {
    console.error('Error initiating deposit:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const mpesaDepositCallback = async (req, res) => {
  const callbackData = req.body;
  // Extract transaction id and status from callbackData according to M-Pesa API spec
  const transactionId = callbackData.Body.stkCallback.CheckoutRequestID;
  const resultCode = callbackData.Body.stkCallback.ResultCode;
  const status = resultCode === 0 ? 'completed' : 'failed';

  try {
    await pool.query('CALL sp_update_deposit_status(?, ?)', [
      transactionId,
      status
    ]);
    res.status(200).json({ message: 'Deposit status updated' });
  } catch (error) {
    console.error('Error updating deposit status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  initiateDeposit,
  mpesaDepositCallback
};
