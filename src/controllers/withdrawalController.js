const pool = require('../db');
const mpesaController = require('../controllers/mpesaController');
const { formatPhoneForMpesa, formatPhoneForDisplay, isValidKenyanPhone } = require('../utils/phoneUtils');
const emailService = require('../utils/emailService');

// Helper function to get system setting
const getSystemSetting = async (settingKey) => {
  try {
    const [rows] = await pool.query('CALL sp_get_setting(?)', [settingKey]);
    if (rows[0] && rows[0][0]) {
      const { setting_value, data_type } = rows[0][0];
      
      switch (data_type) {
        case 'number':
          return parseFloat(setting_value);
        case 'boolean':
          return setting_value.toLowerCase() === 'true';
        case 'json':
          return JSON.parse(setting_value);
        default:
          return setting_value;
      }
    }
    return null;
  } catch (error) {
    console.error(`Error getting setting ${settingKey}:`, error);
    return null;
  }
};

const requestWithdrawal = async (req, res) => {
  const userId = req.user.id;
  const { amount, account_details } = req.body;
  
  if (!amount) {
    return res.status(400).json({ message: 'Amount is required' });
  }
  if (!account_details || typeof account_details !== 'object') {
    return res.status(400).json({ message: 'Valid account details are required' });
  }
  
  try {
    // Get system settings for validation - use settings from database or the hardcoded values
    const minWithdrawal = await getSystemSetting('min_withdrawal_amount') || 50; // Min withdrawal: 50 KES
    const maxWithdrawal = await getSystemSetting('max_withdrawal_amount') || 100000; // Max withdrawal: 100,000 KES
    const dailyLimit = await getSystemSetting('daily_withdrawal_limit') || 100000; // Daily limit same as max withdrawal
    const maxCapital = await getSystemSetting('max_capital_investment') || 5000000; // Max capital: 5,000,000 KES
    const minDeposit = await getSystemSetting('min_deposit_amount') || 5; // Min deposit: 5 KES
    
    // Validate withdrawal amount
    if (amount < minWithdrawal) {
      return res.status(400).json({ 
        message: `Minimum withdrawal amount is KES ${minWithdrawal}` 
      });
    }
    
    if (amount > maxWithdrawal) {
      return res.status(400).json({ 
        message: `Maximum withdrawal amount is KES ${maxWithdrawal}` 
      });
    }

    // Check user balance
    const [balanceRows] = await pool.query('SELECT balance FROM users WHERE id = ?', [userId]);
    if (balanceRows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const userBalance = parseFloat(balanceRows[0].balance);
    console.log(`User balance before withdrawal request: ${userBalance}`);
    
    if (userBalance < amount) {
      return res.status(400).json({ 
        message: 'Insufficient balance',
        available_balance: userBalance
      });
    }

    // Check daily withdrawal limit
    const [dailyWithdrawals] = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) as daily_total 
      FROM withdrawals 
      WHERE user_id = ? AND DATE(created_at) = CURDATE() 
      AND status IN ('pending', 'approved', 'completed')
    `, [userId]);
    
    const todaysWithdrawals = parseFloat(dailyWithdrawals[0].daily_total);
    if (todaysWithdrawals + amount > dailyLimit) {
      return res.status(400).json({ 
        message: `Daily withdrawal limit of KES ${dailyLimit} exceeded. Today's total: KES ${todaysWithdrawals}` 
      });
    }

    // Validate account details based on type
    const accountType = account_details.type || 'mpesa';
    if (accountType === 'mpesa') {
      if (!account_details.phone) {
        return res.status(400).json({ message: 'Phone number is required for M-Pesa withdrawals' });
      }
      // Validate phone number format
      if (!isValidKenyanPhone(account_details.phone)) {
        return res.status(400).json({ 
          message: 'Invalid phone number format. Use 0711111111 or 0111111111 format' 
        });
      }
      // Format phone number for consistency
      account_details.phone = formatPhoneForDisplay(account_details.phone);
    }
    if (accountType === 'bank' && (!account_details.account_number || !account_details.bank_name)) {
      return res.status(400).json({ message: 'Account number and bank name are required for bank withdrawals' });
    }

    const accountDetailsJson = JSON.stringify(account_details);
    const method = accountType;
    
    // Call stored procedure to create withdrawal request
    const [rows] = await pool.query('CALL sp_withdraw(?, ?, ?, ?)', [
      userId,
      amount,
      method,
      accountDetailsJson
    ]);
    
    const withdrawal = rows[0][0];
    
    // Deduct amount from user balance immediately (will be restored if rejected)
    await pool.query('UPDATE users SET balance = balance - ? WHERE id = ?', [amount, userId]);
    
    res.status(201).json({ 
      message: 'Withdrawal request submitted successfully. Awaiting admin approval.',
      withdrawal: {
        id: withdrawal.id,
        amount: withdrawal.amount,
        method: withdrawal.method,
        status: withdrawal.status,
        created_at: withdrawal.created_at
      }
    });
  } catch (error) {
    console.error('Error requesting withdrawal:', error);
    
    // Handle specific database errors
    if (error.sqlState === '45000') {
      return res.status(400).json({ message: error.sqlMessage });
    }
    
    res.status(500).json({ message: 'Internal server error' });
  }
};

const getUserWithdrawals = async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 10, status } = req.query;
  const offset = (page - 1) * limit;
  
  try {
    let query = `
      SELECT id, amount, method, status, account_details, admin_notes,
             created_at, approved_at, completed_at
      FROM withdrawals 
      WHERE user_id = ?
    `;
    const params = [userId];
    
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const [withdrawals] = await pool.query(query, params);
    
    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM withdrawals WHERE user_id = ?';
    const countParams = [userId];
    
    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }
    
    const [countResult] = await pool.query(countQuery, countParams);
    const total = countResult[0].total;
    
    res.json({
      withdrawals,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching user withdrawals:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const approveWithdrawal = async (req, res) => {
  const adminId = req.user.id;
  const withdrawalId = req.params.withdrawalId || req.body.withdrawalId;
  const { auto_process = false, admin_notes } = req.body;
  
  if (!withdrawalId || withdrawalId === 'null') {
    return res.status(400).json({ message: 'Valid withdrawal ID is required' });
  }
  
  try {
    console.log('Approving withdrawal with ID:', withdrawalId);

    // Get withdrawal details first
    const [withdrawalCheck] = await pool.query('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);
    if (withdrawalCheck.length === 0) {
      return res.status(404).json({ message: 'Withdrawal not found' });
    }

    const withdrawal = withdrawalCheck[0];

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending withdrawals can be approved' });
    }

    // Update withdrawal status to approved
    await pool.query(`
      UPDATE withdrawals 
      SET status = 'approved', admin_notes = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `, [admin_notes || 'Approved by admin', adminId, withdrawalId]);

    // Fetch updated withdrawal
    const [updatedRows] = await pool.query('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);
    const updatedWithdrawal = updatedRows[0];

    let response = {
      message: 'Withdrawal approved successfully',
      withdrawal: {
        id: updatedWithdrawal.id,
        amount: updatedWithdrawal.amount,
        status: updatedWithdrawal.status,
        approved_at: updatedWithdrawal.approved_at
      }
    };

    // If auto_process is enabled and method is M-Pesa, initiate payment
    if (auto_process && updatedWithdrawal.method === 'mpesa') {
      try {
        // Extract phone number from account_details
        let phoneNumber;

        if (updatedWithdrawal.account_details) {
          const accountDetails = typeof updatedWithdrawal.account_details === 'string'
            ? JSON.parse(updatedWithdrawal.account_details)
            : updatedWithdrawal.account_details;
          phoneNumber = accountDetails.phone;
        }

        if (phoneNumber) {
          // Create mock request/response for B2C payment
          const mockB2CRequest = {
            body: {
              phone: phoneNumber,
              amount: updatedWithdrawal.amount
            }
          };

          let b2cResponse = null;

          const mockB2CResponse = {
            json: (data) => { b2cResponse = data; },
            status: (code) => ({
              json: (data) => { b2cResponse = { statusCode: code, ...data }; }
            })
          };

          // Call B2C payment
          await mpesaController.b2cPayment(mockB2CRequest, mockB2CResponse);

          response.b2cStatus = 'initiated';
          response.b2cResponse = b2cResponse;
          response.message += ' and M-Pesa payment initiated';
        } else {
          response.warning = 'Phone number not found in account details';
        }
      } catch (b2cError) {
        console.error('B2C Payment failed:', b2cError);
        response.b2cStatus = 'failed';
        response.b2cError = b2cError.message;
        response.message += ' but M-Pesa payment failed';
      }
    }

    // Send email notification
    try {
      // Get user email and full_name
      const [userRows] = await pool.query('SELECT email, full_name FROM users WHERE id = ?', [updatedWithdrawal.user_id]);
      if (userRows.length > 0) {
        const { email, full_name } = userRows[0];
        // Send approval email
        await emailService.sendWithdrawalStatusEmail(email, full_name, {
          ...updatedWithdrawal,
          status: 'approved'
        });
      }
    } catch (emailError) {
      console.error('Error sending approval email:', emailError);
      // Don't fail the request if email sending fails
      response.emailSent = false;
    }

    res.json(response);

  } catch (error) {
    console.error('Error approving withdrawal:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const rejectWithdrawal = async (req, res) => {
  const adminId = req.user.id;
  const withdrawalId = req.params.withdrawalId || req.body.withdrawalId;
  const { admin_notes } = req.body;
  
  if (!withdrawalId || withdrawalId === 'null') {
    return res.status(400).json({ message: 'Valid withdrawal ID is required' });
  }
  
  try {
    console.log('Rejecting withdrawal with ID:', withdrawalId);
    
    // Get withdrawal details
    const [withdrawalRows] = await pool.query(`
      SELECT w.*, u.balance 
      FROM withdrawals w 
      JOIN users u ON w.user_id = u.id 
      WHERE w.id = ?
    `, [withdrawalId]);
    
    if (withdrawalRows.length === 0) {
      return res.status(404).json({ message: 'Withdrawal not found' });
    }
    
    const withdrawal = withdrawalRows[0];
    
    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending withdrawals can be rejected' });
    }
    
    // Restore user balance
    await pool.query('UPDATE users SET balance = balance + ? WHERE id = ?', [
      withdrawal.amount, 
      withdrawal.user_id
    ]);
    
    // Update withdrawal status
    await pool.query(`
      UPDATE withdrawals 
      SET status = 'rejected', admin_notes = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `, [admin_notes || 'Rejected by admin', adminId, withdrawalId]);
    
    // Log admin action
    await pool.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      adminId, 
      'withdrawal_rejected', 
      'withdrawal', 
      withdrawalId, 
      JSON.stringify({ 
        admin_notes, 
        amount_restored: withdrawal.amount,
        user_id: withdrawal.user_id
      })
    ]);
    
    // Get the updated user balance
    const [updatedBalanceRows] = await pool.query('SELECT balance, email, full_name FROM users WHERE id = ?', [withdrawal.user_id]);
    const updatedBalance = updatedBalanceRows[0]?.balance || withdrawal.balance + withdrawal.amount;
    
    // Send rejection email notification
    try {
      if (updatedBalanceRows.length > 0) {
        const { email, full_name } = updatedBalanceRows[0];
        // Send rejection email
        await emailService.sendWithdrawalStatusEmail(email, full_name, {
          ...withdrawal,
          status: 'rejected',
          admin_notes: admin_notes || 'Request rejected by administrator'
        });
      }
    } catch (emailError) {
      console.error('Error sending rejection email:', emailError);
      // Don't fail the request if email sending fails
    }
    
    res.json({ 
      message: 'Withdrawal rejected and amount restored to user balance',
      amount_restored: withdrawal.amount,
      user_id: withdrawal.user_id,
      user_balance: updatedBalance
    });
  } catch (error) {
    console.error('Error rejecting withdrawal:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const mpesaWithdrawalCallback = async (req, res) => {
  const callbackData = req.body;
  
  // Handle B2C callback (different from STK callback)
  if (callbackData.Result) {
    // This is a B2C result callback
    const result = callbackData.Result;
    const status = result.ResultCode === 0 ? 'completed' : 'failed';
    const transactionId = result.TransactionID;
    const conversationId = result.ConversationID;
    
    try {
      // Update withdrawal status based on B2C result
      console.log('B2C Callback received:', {
        status,
        transactionId,
        conversationId,
        resultDesc: result.ResultDesc
      });
      
      // For now, we'll update based on phone and amount from result parameters
      let phone = null;
      let amount = null;
      
      if (result.ResultParameters && result.ResultParameters.ResultParameter) {
        result.ResultParameters.ResultParameter.forEach(param => {
          if (param.Key === 'ReceiverPartyPublicName') {
            phone = param.Value;
          } else if (param.Key === 'TransactionAmount') {
            amount = param.Value;
          }
        });
      }
      
      if (phone && amount) {
        await pool.query(`
          UPDATE withdrawals 
          SET status = ?, transaction_id = ?, completed_at = CURRENT_TIMESTAMP 
          WHERE JSON_EXTRACT(account_details, '$.phone') = ? 
          AND amount = ? 
          AND status = 'approved'
          ORDER BY approved_at DESC 
          LIMIT 1
        `, [status, transactionId, phone, amount]);
      }
      
      res.status(200).json({ message: 'B2C callback processed' });
    } catch (error) {
      console.error('Error processing B2C callback:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  } else if (callbackData.Body && callbackData.Body.stkCallback) {
    // This is an STK callback (shouldn't happen for withdrawals, but just in case)
    res.status(200).json({ message: 'STK Callback processed' });
  } else {
    res.status(400).json({ message: 'Invalid callback format' });
  }
};

const deleteWithdrawal = async (req, res) => {
  const adminId = req.user.id;
  const { withdrawalId } = req.params;
  
  try {
    // Get withdrawal details first
    const [withdrawalRows] = await pool.query(`
      SELECT w.*, u.balance 
      FROM withdrawals w 
      JOIN users u ON w.user_id = u.id 
      WHERE w.id = ?
    `, [withdrawalId]);
    
    if (withdrawalRows.length === 0) {
      return res.status(404).json({ message: 'Withdrawal not found' });
    }
    
    const withdrawal = withdrawalRows[0];
    
    // If withdrawal is pending, restore the amount to user's balance
    if (withdrawal.status === 'pending') {
      await pool.query('UPDATE users SET balance = balance + ? WHERE id = ?', [
        withdrawal.amount, 
        withdrawal.user_id
      ]);
    }
    
    // Delete the withdrawal record
    await pool.query('DELETE FROM withdrawals WHERE id = ?', [withdrawalId]);
    
    // Log admin action
    await pool.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      adminId, 
      'withdrawal_deleted', 
      'withdrawal', 
      withdrawalId, 
      JSON.stringify({ 
        status: withdrawal.status, 
        amount: withdrawal.amount,
        user_id: withdrawal.user_id,
        amount_restored: withdrawal.status === 'pending' ? withdrawal.amount : 0
      })
    ]);
    
    // Get user details and send notification if the withdrawal was pending
    if (withdrawal.status === 'pending') {
      try {
        const [userRows] = await pool.query('SELECT email, full_name FROM users WHERE id = ?', [withdrawal.user_id]);
        
        if (userRows.length > 0) {
          const { email, full_name } = userRows[0];
          
          // Send cancellation email (using the rejection template)
          await emailService.sendWithdrawalStatusEmail(email, full_name, {
            ...withdrawal,
            status: 'rejected', // Use rejected template
            admin_notes: 'This withdrawal request was canceled by an administrator.'
          });
        }
      } catch (emailError) {
        console.error('Error sending deletion notification email:', emailError);
        // Don't fail the request if email sending fails
      }
    }
    
    res.json({ 
      message: `Withdrawal deleted successfully${withdrawal.status === 'pending' ? ' and amount restored to user balance' : ''}`,
      amount_restored: withdrawal.status === 'pending' ? withdrawal.amount : 0
    });
  } catch (error) {
    console.error('Error deleting withdrawal:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const markWithdrawalCompleted = async (req, res) => {
  const adminId = req.user.id;
  const { withdrawalId } = req.params;
  const { admin_notes } = req.body;
  
  try {
    // Get withdrawal details first
    const [withdrawalCheck] = await pool.query('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);
    if (withdrawalCheck.length === 0) {
      return res.status(404).json({ message: 'Withdrawal not found' });
    }
    
    if (withdrawalCheck[0].status !== 'approved') {
      return res.status(400).json({ message: 'Only approved withdrawals can be marked as completed' });
    }
    
    // Update withdrawal status to completed (use completed_at)
    await pool.query(`
      UPDATE withdrawals 
      SET status = 'completed', 
          admin_notes = CONCAT(IFNULL(admin_notes, ''), '\n', ?),
          completed_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `, [
      `Marked as completed by admin: ${admin_notes || 'No additional notes'}`, 
      withdrawalId
    ]);
    
    // Log admin action
    await pool.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      adminId, 
      'withdrawal_completed', 
      'withdrawal', 
      withdrawalId, 
      JSON.stringify({ admin_notes })
    ]);
    
    // Get user details and send completion email
    try {
      const [userRows] = await pool.query(`
        SELECT u.email, u.full_name, w.amount, w.method, w.created_at, w.completed_at, w.account_details
        FROM withdrawals w
        JOIN users u ON w.user_id = u.id
        WHERE w.id = ?
      `, [withdrawalId]);
      
      if (userRows.length > 0) {
        const { email, full_name, amount, method, created_at, completed_at, account_details } = userRows[0];
        
        // Send completion email (no transaction_id)
        await emailService.sendWithdrawalStatusEmail(email, full_name, {
          amount,
          method,
          created_at,
          completed_at,
          account_details,
          status: 'completed'
        });
      }
    } catch (emailError) {
      console.error('Error sending completion email:', emailError);
      // Don't fail the request if email sending fails
    }
    
    res.json({ 
      message: 'Withdrawal marked as completed successfully',
      withdrawal_id: withdrawalId
    });
  } catch (error) {
    console.error('Error marking withdrawal as completed:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  requestWithdrawal,
  getUserWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
  deleteWithdrawal,
  markWithdrawalCompleted,
  mpesaWithdrawalCallback
};