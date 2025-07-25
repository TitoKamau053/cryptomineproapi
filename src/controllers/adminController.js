const pool = require('../db');

const getAdminStats = async (req, res) => {
  try {
    const [rows] = await pool.query('CALL sp_get_admin_stats()');
    const stats = rows[0][0];
    res.json({ stats });
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const getSystemSettings = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT setting_key, setting_value, description FROM system_settings');
    res.json({ settings: rows });
  } catch (error) {
    console.error('Error fetching system settings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const updateSystemSetting = async (req, res) => {
  const { setting_key, setting_value } = req.body;
  const adminId = req.user.id;
  if (!setting_key || !setting_value) {
    return res.status(400).json({ message: 'Setting key and value are required' });
  }
  try {
    const [rows] = await pool.query('CALL sp_update_setting(?, ?, ?)', [
      setting_key,
      setting_value,
      adminId
    ]);
    const result = rows[0][0];
    res.json({ message: result.message });
  } catch (error) {
    console.error('Error updating system setting:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// === USER MANAGEMENT ===
const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, role, search } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT id, email, full_name, phone, role, balance, total_earnings, 
             referral_code, status, last_login, created_at 
      FROM users 
      WHERE 1=1
    `;
    const params = [];
    
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    
    if (role) {
      query += ' AND role = ?';
      params.push(role);
    }
    
    if (search) {
      query += ' AND (email LIKE ? OR full_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const [users] = await pool.query(query, params);
    
    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM users WHERE 1=1';
    const countParams = [];
    
    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }
    
    if (role) {
      countQuery += ' AND role = ?';
      countParams.push(role);
    }
    
    if (search) {
      countQuery += ' AND (email LIKE ? OR full_name LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`);
    }
    
    const [countResult] = await pool.query(countQuery, countParams);
    const total = countResult[0].total;
    
    res.json({
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const getUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get user details
    const [userRows] = await pool.query(`
      SELECT id, email, full_name, phone, role, balance, total_earnings, 
             referral_code, referred_by, status, email_verified, last_login, 
             created_at, updated_at 
      FROM users 
      WHERE id = ?
    `, [userId]);
    
    if (userRows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const user = userRows[0];
    
    // Get user's deposits
    const [deposits] = await pool.query(`
      SELECT id, amount, method, status, transaction_id, created_at 
      FROM deposits 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT 10
    `, [userId]);
    
    // Get user's withdrawals
    const [withdrawals] = await pool.query(`
      SELECT id, amount, method, status, created_at 
      FROM withdrawals 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT 10
    `, [userId]);
    
    // Get user's purchases
    const [purchases] = await pool.query(`
      SELECT p.id, p.amount_invested, p.daily_earning, p.total_earned, 
             p.start_date, p.end_date, p.status, m.name as engine_name
      FROM purchases p
      JOIN mining_engines m ON p.engine_id = m.id
      WHERE p.user_id = ? 
      ORDER BY p.created_at DESC 
      LIMIT 10
    `, [userId]);
    
    // Get referral info if user was referred
    let referrer = null;
    if (user.referred_by) {
      const [referrerRows] = await pool.query(`
        SELECT id, email, full_name, referral_code 
        FROM users 
        WHERE id = ?
      `, [user.referred_by]);
      
      if (referrerRows.length > 0) {
        referrer = referrerRows[0];
      }
    }
    
    // Get users referred by this user
    const [referrals] = await pool.query(`
      SELECT u.id, u.email, u.full_name, u.created_at, r.commission_rate, r.total_commission
      FROM users u
      JOIN referrals r ON u.id = r.referred_id
      WHERE r.referrer_id = ?
      ORDER BY u.created_at DESC
    `, [userId]);
    
    res.json({
      user,
      deposits,
      withdrawals,
      purchases,
      referrer,
      referrals
    });
  } catch (error) {
    console.error('Error fetching user details:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const updateUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, reason } = req.body;
    const adminId = req.user.id;
    
    // Debug logging
    console.log('updateUserStatus called with:', { userId, status, reason, adminId });
    console.log('Request body:', req.body);
    console.log('Request params:', req.params);
    console.log('User object:', req.user);
    
    // Validate required fields
    if (!status) {
      console.log('Status validation failed: status is required');
      return res.status(400).json({ message: 'Status is required' });
    }
    
    if (!['active', 'suspended', 'pending', 'deactivated'].includes(status)) {
      console.log('Status validation failed: invalid status value:', status);
      return res.status(400).json({ message: 'Invalid status. Must be one of: active, suspended, pending, deactivated' });
    }
    
    // Map 'deactivated' to 'suspended' for database compatibility
    // Since the database ENUM only supports ('active', 'suspended', 'pending')
    const dbStatus = status === 'deactivated' ? 'suspended' : status;
    
    // Check if user exists
    const [userCheck] = await pool.query('SELECT id FROM users WHERE id = ?', [userId]);
    if (userCheck.length === 0) {
      console.log('User not found with ID:', userId);
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Validate admin user exists
    if (!adminId) {
      console.log('Admin ID not found in request');
      return res.status(401).json({ message: 'Admin user not found' });
    }
    
    await pool.query(`
      UPDATE users 
      SET status = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `, [dbStatus, userId]);
    
    // Log admin action (if table exists)
    try {
      await pool.query(`
        INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [adminId, 'user_status_update', 'user', userId, JSON.stringify({ status, reason })]);
    } catch (logError) {
      console.warn('Failed to log admin action:', logError.message);
      // Continue execution even if logging fails
    }
    
    res.json({ message: 'User status updated successfully' });
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const adjustUserBalance = async (req, res) => {
  try {
    const { userId } = req.params;
    const { amount, type, reason } = req.body;
    const adminId = req.user.id;
    
    if (!amount || !type || !['add', 'subtract'].includes(type)) {
      return res.status(400).json({ message: 'Valid amount and type (add/subtract) are required' });
    }
    
    const adjustmentAmount = type === 'add' ? Math.abs(amount) : -Math.abs(amount);
    
    await pool.query(`
      UPDATE users 
      SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `, [adjustmentAmount, userId]);
    
    // Log admin action
    await pool.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [adminId, 'balance_adjustment', 'user', userId, JSON.stringify({ amount: adjustmentAmount, reason })]);
    
    res.json({ message: 'User balance adjusted successfully' });
  } catch (error) {
    console.error('Error adjusting user balance:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// === DEPOSIT MANAGEMENT ===
const getAllDeposits = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, method } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT d.id, d.amount, d.method, d.status, d.transaction_id, 
             d.created_at, u.email, u.full_name
      FROM deposits d
      JOIN users u ON d.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    
    if (status) {
      query += ' AND d.status = ?';
      params.push(status);
    }
    
    if (method) {
      query += ' AND d.method = ?';
      params.push(method);
    }
    
    query += ' ORDER BY d.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const [deposits] = await pool.query(query, params);
    
    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM deposits WHERE 1=1';
    const countParams = [];
    
    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }
    
    if (method) {
      countQuery += ' AND method = ?';
      countParams.push(method);
    }
    
    const [countResult] = await pool.query(countQuery, countParams);
    const total = countResult[0].total;
    
    res.json({
      deposits,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching deposits:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const updateDepositStatus = async (req, res) => {
  try {
    const { depositId } = req.params;
    const { status, admin_notes } = req.body;
    const adminId = req.user.id;
    
    if (!['pending', 'completed', 'failed', 'cancelled'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    
    await pool.query(`
      UPDATE deposits 
      SET status = ?, admin_notes = ?, processed_by = ?, processed_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `, [status, admin_notes, adminId, depositId]);
    
    res.json({ message: 'Deposit status updated successfully' });
  } catch (error) {
    console.error('Error updating deposit status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const deleteDeposit = async (req, res) => {
  try {
    const { depositId } = req.params;
    const { reason } = req.body;
    const adminId = req.user.id;
    
    // Get deposit details before deletion
    const [depositRows] = await pool.query('SELECT * FROM deposits WHERE id = ?', [depositId]);
    
    if (depositRows.length === 0) {
      return res.status(404).json({ message: 'Deposit not found' });
    }
    
    const deposit = depositRows[0];
    
    // Log admin action before deletion
    await pool.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [adminId, 'deposit_deletion', 'deposit', depositId, JSON.stringify({ deposit, reason })]);
    
    // Delete the deposit
    await pool.query('DELETE FROM deposits WHERE id = ?', [depositId]);
    
    res.json({ message: 'Deposit deleted successfully' });
  } catch (error) {
    console.error('Error deleting deposit:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// === WITHDRAWAL MANAGEMENT ===
const getAllWithdrawals = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, method } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT w.id, w.amount, w.method, w.status, w.created_at, w.approved_at,
             u.email, u.full_name, w.account_details
      FROM withdrawals w
      JOIN users u ON w.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    
    if (status) {
      query += ' AND w.status = ?';
      params.push(status);
    }
    
    if (method) {
      query += ' AND w.method = ?';
      params.push(method);
    }
    
    query += ' ORDER BY w.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const [withdrawals] = await pool.query(query, params);
    
    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM withdrawals WHERE 1=1';
    const countParams = [];
    
    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }
    
    if (method) {
      countQuery += ' AND method = ?';
      countParams.push(method);
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
    console.error('Error fetching withdrawals:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const updateWithdrawalStatus = async (req, res) => {
  try {
    const { withdrawalId } = req.params;
    const { status, admin_notes } = req.body;
    const adminId = req.user.id;
    
    if (!['pending', 'approved', 'rejected', 'completed'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    
    // Get withdrawal details
    const [withdrawalRows] = await pool.query(`
      SELECT w.*, u.email, u.balance 
      FROM withdrawals w 
      JOIN users u ON w.user_id = u.id 
      WHERE w.id = ?
    `, [withdrawalId]);
    
    if (withdrawalRows.length === 0) {
      return res.status(404).json({ message: 'Withdrawal not found' });
    }
    
    const withdrawal = withdrawalRows[0];
    
    // If rejecting, restore user balance
    if (status === 'rejected' && withdrawal.status === 'pending') {
      await pool.query(`
        UPDATE users 
        SET balance = balance + ?
        WHERE id = ?
      `, [withdrawal.amount, withdrawal.user_id]);
    }
    
    // Update withdrawal status
    await pool.query(`
      UPDATE withdrawals 
      SET status = ?, admin_notes = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `, [status, admin_notes, adminId, withdrawalId]);
    
    // Log admin action
    await pool.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [adminId, 'withdrawal_status_update', 'withdrawal', withdrawalId, JSON.stringify({ status, admin_notes, previous_status: withdrawal.status })]);
    
    res.json({ message: 'Withdrawal status updated successfully' });
  } catch (error) {
    console.error('Error updating withdrawal status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const processWithdrawal = async (req, res) => {
  try {
    const { withdrawalId } = req.params;
    const { transaction_reference, admin_notes } = req.body;
    const adminId = req.user.id;
    
    // Update withdrawal as completed with transaction reference
    await pool.query(`
      UPDATE withdrawals 
      SET status = 'completed', 
          transaction_reference = ?, 
          admin_notes = ?, 
          processed_by = ?, 
          processed_at = CURRENT_TIMESTAMP 
      WHERE id = ? AND status = 'approved'
    `, [transaction_reference, admin_notes, adminId, withdrawalId]);
    
    // Log admin action
    await pool.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [adminId, 'withdrawal_processed', 'withdrawal', withdrawalId, JSON.stringify({ transaction_reference, admin_notes })]);
    
    res.json({ message: 'Withdrawal processed successfully' });
  } catch (error) {
    console.error('Error processing withdrawal:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// === MINING ENGINE MANAGEMENT ===
const getAllMiningEngines = async (req, res) => {
  try {
    const { page = 1, limit = 20, is_active } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT id, name, description, price, daily_earning_rate, duration_days,
             min_investment, max_investment, image_url, is_active, created_at, updated_at
      FROM mining_engines
      WHERE 1=1
    `;
    const params = [];
    
    if (is_active !== undefined) {
      query += ' AND is_active = ?';
      params.push(is_active === 'true');
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const [engines] = await pool.query(query, params);
    
    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM mining_engines WHERE 1=1';
    const countParams = [];
    
    if (is_active !== undefined) {
      countQuery += ' AND is_active = ?';
      countParams.push(is_active === 'true');
    }
    
    const [countResult] = await pool.query(countQuery, countParams);
    const total = countResult[0].total;
    
    res.json({
      engines,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching mining engines:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const createMiningEngine = async (req, res) => {
  try {
    const { name, description, price, daily_earning_rate, duration_days, min_investment, max_investment, image_url } = req.body;
    const adminId = req.user.id;
    
    if (!name || !price || !daily_earning_rate || !duration_days) {
      return res.status(400).json({ message: 'Name, price, daily earning rate, and duration are required' });
    }
    
    const [result] = await pool.query(`
      INSERT INTO mining_engines (name, description, price, daily_earning_rate, duration_days, min_investment, max_investment, image_url, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP)
    `, [name, description, price, daily_earning_rate, duration_days, min_investment || 0, max_investment || 999999999.99, image_url]);
    
    // Log admin action
    await pool.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [adminId, 'mining_engine_created', 'mining_engine', result.insertId, JSON.stringify({ name, price, daily_earning_rate, duration_days })]);
    
    res.status(201).json({ 
      message: 'Mining engine created successfully',
      engine_id: result.insertId 
    });
  } catch (error) {
    console.error('Error creating mining engine:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const updateMiningEngine = async (req, res) => {
  try {
    const { engineId } = req.params;
    const { name, description, price, daily_earning_rate, duration_days, min_investment, max_investment, image_url, is_active } = req.body;
    const adminId = req.user.id;
    
    const [result] = await pool.query(`
      UPDATE mining_engines 
      SET name = COALESCE(?, name),
          description = COALESCE(?, description),
          price = COALESCE(?, price),
          daily_earning_rate = COALESCE(?, daily_earning_rate),
          duration_days = COALESCE(?, duration_days),
          min_investment = COALESCE(?, min_investment),
          max_investment = COALESCE(?, max_investment),
          image_url = COALESCE(?, image_url),
          is_active = COALESCE(?, is_active),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [name, description, price, daily_earning_rate, duration_days, min_investment, max_investment, image_url, is_active, engineId]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Mining engine not found' });
    }
    
    // Log admin action
    await pool.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [adminId, 'mining_engine_updated', 'mining_engine', engineId, JSON.stringify(req.body)]);
    
    res.json({ message: 'Mining engine updated successfully' });
  } catch (error) {
    console.error('Error updating mining engine:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const deleteMiningEngine = async (req, res) => {
  try {
    const { engineId } = req.params;
    const { force } = req.query;
    const adminId = req.user.id;
    
    // Check if engine exists
    const [existingEngine] = await pool.query('SELECT * FROM mining_engines WHERE id = ?', [engineId]);
    if (existingEngine.length === 0) {
      return res.status(404).json({ message: 'Mining engine not found' });
    }

    // Check if engine has active purchases (unless force delete)
    if (force !== 'true') {
      const [activePurchases] = await pool.query(`
        SELECT COUNT(*) as count FROM purchases 
        WHERE engine_id = ? AND status IN ('active', 'pending')
      `, [engineId]);
      
      if (activePurchases[0].count > 0) {
        return res.status(400).json({ 
          message: 'Cannot delete mining engine with active purchases. Use force=true to override.',
          active_purchases: activePurchases[0].count
        });
      }
    }

    await pool.query('DELETE FROM mining_engines WHERE id = ?', [engineId]);

    // Log admin action
    await pool.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [adminId, 'mining_engine_deleted', 'mining_engine', engineId, JSON.stringify({ engine: existingEngine[0], force: force === 'true' })]);

    res.json({ message: 'Mining engine deleted successfully' });
  } catch (error) {
    console.error('Error deleting mining engine:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// === REFERRAL MANAGEMENT ===
const getReferralStats = async (req, res) => {
  try {
    const [stats] = await pool.query(`
      SELECT 
        COUNT(r.id) as total_referrals,
        COUNT(DISTINCT r.referrer_id) as active_referrers,
        COALESCE(SUM(rc.commission_amount), 0) as total_commissions_paid,
        AVG(r.commission_rate) as avg_commission_rate
      FROM referrals r
      LEFT JOIN referral_commissions rc ON r.id = rc.referral_id
    `);
    
    const [topReferrers] = await pool.query(`
      SELECT 
        u.id, u.email, u.full_name,
        COUNT(r.id) as total_referrals,
        COALESCE(SUM(rc.commission_amount), 0) as total_commissions
      FROM users u
      JOIN referrals r ON u.id = r.referrer_id
      LEFT JOIN referral_commissions rc ON r.id = rc.referral_id
      GROUP BY u.id, u.email, u.full_name
      ORDER BY total_commissions DESC
      LIMIT 10
    `);
    
    res.json({
      stats: stats[0],
      top_referrers: topReferrers
    });
  } catch (error) {
    console.error('Error fetching referral stats:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// === ADMIN LOGS ===
const getAdminLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50, admin_id, action } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT al.id, al.action, al.target_type, al.target_id, al.details, al.created_at,
             u.email as admin_email, u.full_name as admin_name
      FROM admin_logs al
      JOIN users u ON al.admin_id = u.id
      WHERE 1=1
    `;
    const params = [];
    
    if (admin_id) {
      query += ' AND al.admin_id = ?';
      params.push(admin_id);
    }
    
    if (action) {
      query += ' AND al.action = ?';
      params.push(action);
    }
    
    query += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const [logs] = await pool.query(query, params);
    
    res.json({ logs });
  } catch (error) {
    console.error('Error fetching admin logs:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Get recent admin activities for dashboard
const getAdminActivities = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    const [activities] = await pool.query(`
      SELECT 
        al.action,
        al.target_type,
        al.target_id,
        al.details,
        al.created_at,
        u.full_name as admin_name,
        u.email as admin_email,
        CASE 
          WHEN al.target_type = 'user' THEN target_user.email
          WHEN al.target_type = 'deposit' THEN CONCAT('Deposit #', al.target_id)
          WHEN al.target_type = 'withdrawal' THEN CONCAT('Withdrawal #', al.target_id)
          ELSE CONCAT(al.target_type, ' #', al.target_id)
        END as target_name
      FROM admin_logs al
      JOIN users u ON al.admin_id = u.id
      LEFT JOIN users target_user ON al.target_type = 'user' AND al.target_id = target_user.id
      ORDER BY al.created_at DESC
      LIMIT ?
    `, [parseInt(limit)]);
    
    const formattedActivities = activities.map(activity => {
      let actionText = activity.action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      let details = '';
      
      try {
        const activityDetails = JSON.parse(activity.details || '{}');
        if (activity.action === 'user_status_update') {
          details = `Account ${activityDetails.status}`;
        } else if (activity.action === 'balance_adjustment') {
          details = `Balance ${activityDetails.amount > 0 ? 'increased' : 'decreased'} by KES ${Math.abs(activityDetails.amount)}`;
        } else if (activity.action === 'deposit_status_update') {
          details = `Status changed to ${activityDetails.status}`;
        } else if (activity.action === 'withdrawal_processed') {
          details = 'Payment processed successfully';
        }
      } catch (e) {
        details = actionText;
      }
      
      return {
        admin: activity.admin_name || 'System Administrator',
        action: actionText,
        target: activity.target_name,
        details,
        timestamp: activity.created_at
      };
    });
    
    res.json({ activities: formattedActivities });
  } catch (error) {
    console.error('Error fetching admin activities:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  // System Management
  getAdminStats,
  getSystemSettings,
  updateSystemSetting,
  
  // User Management
  getAllUsers,
  getUserDetails,
  updateUserStatus,
  adjustUserBalance,
  
  // Deposit Management
  getAllDeposits,
  updateDepositStatus,
  deleteDeposit,
  
  // Withdrawal Management
  getAllWithdrawals,
  updateWithdrawalStatus,
  processWithdrawal,
  
  // Mining Engine Management
  getAllMiningEngines,
  createMiningEngine,
  updateMiningEngine,
  deleteMiningEngine,
  
  // Referral Management
  getReferralStats,
  
  // Admin Logs
  getAdminLogs,
  getAdminActivities
};
