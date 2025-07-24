const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { sendVerificationEmail, sendWelcomeEmail } = require('../utils/emailService');

const registerUser = async (req, res) => {
  const { email, password, full_name, phone, referred_by } = req.body;
  
  console.log('Registration attempt:', { email, full_name, phone, referred_by });
  
  if (!email || !password || !full_name) {
    return res.status(400).json({ message: 'Email, password, and full name are required' });
  }
  
  try {
    // Check if user already exists
    const [existingUser] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser.length > 0) {
      console.log('User already exists:', email);
      return res.status(400).json({ message: 'Email already registered' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log('Password hashed successfully');
    
    // Call stored procedure sp_register_user_with_verification
    console.log('Calling sp_register_user_with_verification with params:', [email, hashedPassword, full_name, phone || null, referred_by || null]);
    
    const [rows] = await pool.query('CALL sp_register_user_with_verification(?, ?, ?, ?, ?)', [
      email,
      hashedPassword,
      full_name,
      phone || null,
      referred_by || null
    ]);
    
    console.log('Stored procedure result:', rows);
    
    if (rows && rows[0] && rows[0][0]) {
      const user = rows[0][0];
      const { verification_token } = user;
      
      console.log('User registered successfully:', user);
      
      // Send verification email
      const emailResult = await sendVerificationEmail(email, full_name, verification_token);
      if (!emailResult.success) {
        console.error('Failed to send verification email:', emailResult.error);
        // Don't fail registration if email fails, just log it
      }
      
      // Remove sensitive data from response
      const { verification_token: token, token_expiry, ...userResponse } = user;
      
      res.status(201).json({ 
        user: userResponse,
        message: 'Registration successful! Please check your email to verify your account before logging in.',
        emailSent: emailResult.success
      });
    } else {
      console.error('No user data returned from stored procedure');
      res.status(500).json({ message: 'Failed to register user - no data returned' });
    }
  } catch (error) {
    console.error('Error registering user:', error);
    
    // Handle specific MySQL errors
    if (error.code === 'ER_SP_DOES_NOT_EXIST') {
      return res.status(500).json({ message: 'Database configuration error: stored procedure not found' });
    }
    
    if (error.sqlState === '45000') {
      return res.status(400).json({ message: error.sqlMessage || 'Registration failed due to validation error' });
    }
    
    res.status(500).json({ 
      message: 'Internal server error', 
      error: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
};

const loginUser = async (req, res) => {
  const { email, password } = req.body;
  
  console.log('Login attempt:', email);
  
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }
  
  try {
    // Call stored procedure sp_login_user_verified
    const [rows] = await pool.query('CALL sp_login_user_verified(?)', [email]);
    
    console.log('Login query result:', rows);
    
    if (!rows || !rows[0] || !rows[0][0]) {
      console.log('No user found for email:', email);
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    const user = rows[0][0];
    console.log('User found:', { id: user.id, email: user.email, role: user.role, email_verified: user.email_verified });
    
    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      console.log('Password mismatch for user:', email);
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    // Check if email is verified
    if (!user.email_verified) {
      console.log('Email not verified for user:', email);
      return res.status(403).json({ 
        message: 'Please verify your email address before logging in. Check your inbox for the verification link.',
        emailVerified: false,
        canResendVerification: true
      });
    }
    
    // Update last login timestamp
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
    
    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );
    
    console.log('Login successful for user:', email);
    
    res.json({ 
      token, 
      user: { 
        id: user.id, 
        email: user.email, 
        full_name: user.full_name, 
        role: user.role,
        email_verified: user.email_verified,
        status: user.status
      } 
    });
  } catch (error) {
    console.error('Error logging in user:', error);
    
    // Handle specific MySQL errors
    if (error.code === 'ER_SP_DOES_NOT_EXIST') {
      return res.status(500).json({ message: 'Database configuration error: stored procedure not found' });
    }
    
    res.status(500).json({ 
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
};

// Email verification endpoint
const verifyEmail = async (req, res) => {
  const { token } = req.query;
  
  if (!token) {
    return res.status(400).json({ message: 'Verification token is required' });
  }
  
  try {
    // Call stored procedure to verify email
    const [rows] = await pool.query('CALL sp_verify_email(?)', [token]);
    
    if (rows && rows[0] && rows[0][0]) {
      const result = rows[0][0];
      console.log('Email verification successful:', result);
      
      // Get user details for welcome email
      const [userRows] = await pool.query('SELECT email, full_name FROM users WHERE id = ?', [result.user_id]);
      if (userRows.length > 0) {
        const user = userRows[0];
        
        // Send welcome email
        const emailResult = await sendWelcomeEmail(user.email, user.full_name);
        if (!emailResult.success) {
          console.error('Failed to send welcome email:', emailResult.error);
        }
      }
      
      // Redirect to success page or return JSON
      if (req.headers.accept && req.headers.accept.includes('text/html')) {
        // Browser request - redirect to success page
        const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
        res.redirect(`${baseUrl}/verification-success?verified=true`);
      } else {
        // API request - return JSON
        res.json({ 
          message: 'Email verified successfully! You can now log in to your account.',
          verified: true
        });
      }
    }
  } catch (error) {
    console.error('Error verifying email:', error);
    
    let errorMessage = 'Email verification failed';
    if (error.sqlState === '45000') {
      errorMessage = error.sqlMessage;
    }
    
    // Handle browser vs API requests
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
      const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
      res.redirect(`${baseUrl}/verification-error?error=${encodeURIComponent(errorMessage)}`);
    } else {
      res.status(400).json({ message: errorMessage, verified: false });
    }
  }
};

// Resend verification email
const resendVerificationEmail = async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ message: 'Email address is required' });
  }
  
  try {
    // Call stored procedure to generate new verification token
    const [rows] = await pool.query('CALL sp_resend_verification(?)', [email]);
    
    if (rows && rows[0] && rows[0][0]) {
      const result = rows[0][0];
      console.log('New verification token generated:', result);
      
      // Get user details
      const [userRows] = await pool.query('SELECT full_name FROM users WHERE email = ?', [email]);
      const userName = userRows.length > 0 ? userRows[0].full_name : 'User';
      
      // Send verification email
      const emailResult = await sendVerificationEmail(email, userName, result.verification_token);
      
      if (emailResult.success) {
        res.json({ 
          message: 'Verification email sent successfully! Please check your inbox.',
          emailSent: true
        });
      } else {
        res.status(500).json({ 
          message: 'Failed to send verification email. Please try again later.',
          emailSent: false,
          error: emailResult.error
        });
      }
    }
  } catch (error) {
    console.error('Error resending verification email:', error);
    
    let errorMessage = 'Failed to resend verification email';
    if (error.sqlState === '45000') {
      errorMessage = error.sqlMessage;
    }
    
    res.status(400).json({ message: errorMessage, emailSent: false });
  }
};

// Check email verification status
const checkEmailVerificationStatus = async (req, res) => {
  const { email } = req.query;
  
  if (!email) {
    return res.status(400).json({ message: 'Email address is required' });
  }
  
  try {
    const [userRows] = await pool.query(
      'SELECT id, email, email_verified, email_verified_at, status FROM users WHERE email = ?', 
      [email]
    );
    
    if (userRows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const user = userRows[0];
    res.json({
      email: user.email,
      emailVerified: user.email_verified,
      verifiedAt: user.email_verified_at,
      accountStatus: user.status,
      canResendVerification: !user.email_verified
    });
  } catch (error) {
    console.error('Error checking verification status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const getUserProfile = async (req, res) => {
  const userId = req.user.id;
  try {
    // Get user basic info
    const [userRows] = await pool.query(`
      SELECT id, email, full_name, phone, role, balance, total_earnings, referral_code, status, created_at 
      FROM users 
      WHERE id = ?
    `, [userId]);
    
    if (userRows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const user = userRows[0];
    
    // Get total deposits
    const [depositStats] = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) as total_deposits
      FROM deposits 
      WHERE user_id = ? AND status = 'completed'
    `, [userId]);
    
    // Get total withdrawals
    const [withdrawalStats] = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) as total_withdrawals
      FROM withdrawals 
      WHERE user_id = ? AND status = 'completed'
    `, [userId]);
    
    // Enhance user object with additional statistics
    const enhancedUser = {
      ...user,
      total_deposits: depositStats[0].total_deposits,
      total_withdrawals: withdrawalStats[0].total_withdrawals
    };
    
    res.json({ user: enhancedUser });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const updateProfile = async (req, res) => {
  const userId = req.user.id;
  const { full_name, phone } = req.body;
  
  try {
    await pool.query(
      'UPDATE users SET full_name = ?, phone = ? WHERE id = ?',
      [full_name, phone, userId]
    );
    
    const [updatedUser] = await pool.query(
      'SELECT id, email, full_name, phone, referral_code, status, balance, created_at FROM users WHERE id = ?',
      [userId]
    );
    
    res.json({ 
      message: 'Profile updated successfully',
      user: updatedUser[0]
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const changePassword = async (req, res) => {
  const userId = req.user.id;
  const { current_password, new_password } = req.body;
  
  if (!current_password || !new_password) {
    return res.status(400).json({ message: 'Current password and new password are required' });
  }
  
  if (new_password.length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters long' });
  }
  
  try {
    // Get current password hash
    const [userRows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [userId]);
    if (userRows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Verify current password
    const isValidPassword = await bcrypt.compare(current_password, userRows[0].password_hash);
    if (!isValidPassword) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }
    
    // Hash new password
    const saltRounds = 10;
    const hashedNewPassword = await bcrypt.hash(new_password, saltRounds);
    
    // Update password
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hashedNewPassword, userId]);
    
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Admin-only functions
const getAllUsers = async (req, res) => {
  const { page = 1, limit = 20, search = '', status = '', sort_by = 'created_at', sort_dir = 'DESC' } = req.query;
  const offset = (page - 1) * limit;
  
  try {
    let whereClause = 'WHERE 1=1';
    let params = [];
    
    if (search) {
      whereClause += ' AND (full_name LIKE ? OR email LIKE ? OR phone LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }
    
    const validSortColumns = ['created_at', 'full_name', 'email', 'balance', 'status'];
    const sortColumn = validSortColumns.includes(sort_by) ? sort_by : 'created_at';
    const sortDirection = sort_dir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    
    const [users] = await pool.query(`
      SELECT id, email, full_name, phone, referral_code, status, balance, role,
             created_at, updated_at,
             (SELECT COUNT(*) FROM referrals WHERE referrer_id = users.id) as total_referrals
      FROM users 
      ${whereClause}
      ORDER BY ${sortColumn} ${sortDirection}
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), parseInt(offset)]);
    
    const [countResult] = await pool.query(`
      SELECT COUNT(*) as total FROM users ${whereClause}
    `, params);
    
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

const getUserById = async (req, res) => {
  const { id } = req.params;
  
  try {
    const [userRows] = await pool.query(`
      SELECT id, email, full_name, phone, referral_code, status, balance, role,
             created_at, updated_at, referred_by,
             (SELECT COUNT(*) FROM referrals WHERE referrer_id = users.id) as total_referrals,
             (SELECT COALESCE(SUM(commission_amount), 0) FROM referral_commissions rc 
              JOIN referrals r ON rc.referral_id = r.id WHERE r.referrer_id = users.id) as total_commissions
      FROM users WHERE id = ?
    `, [id]);
    
    if (userRows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const user = userRows[0];
    
    // Get referrer info if exists
    if (user.referred_by) {
      const [referrerRows] = await pool.query(
        'SELECT id, full_name, email FROM users WHERE id = ?',
        [user.referred_by]
      );
      user.referrer = referrerRows[0] || null;
    } else {
      user.referrer = null;
    }
    
    res.json({ user });
  } catch (error) {
    console.error('Error fetching user by ID:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const updateUserStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const adminId = req.user.id;
  
  const validStatuses = ['active', 'suspended', 'inactive'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ message: 'Invalid status. Must be active, suspended, or inactive' });
  }
  
  try {
    // Check if user exists
    const [userRows] = await pool.query('SELECT id, status, full_name FROM users WHERE id = ?', [id]);
    if (userRows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const oldStatus = userRows[0].status;
    
    // Update status
    await pool.query('UPDATE users SET status = ?, updated_at = NOW() WHERE id = ?', [status, id]);
    
    // Log admin action
    await pool.query(
      'INSERT INTO admin_logs (admin_id, action, details, created_at) VALUES (?, ?, ?, NOW())',
      [adminId, 'update_user_status', `Changed user ${userRows[0].full_name} (ID: ${id}) status from ${oldStatus} to ${status}`]
    );
    
    res.json({ 
      message: 'User status updated successfully',
      old_status: oldStatus,
      new_status: status
    });
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const updateUserBalance = async (req, res) => {
  const { id } = req.params;
  const { balance, reason } = req.body;
  const adminId = req.user.id;
  
  if (typeof balance !== 'number' || balance < 0) {
    return res.status(400).json({ message: 'Balance must be a non-negative number' });
  }
  
  if (!reason || reason.trim().length === 0) {
    return res.status(400).json({ message: 'Reason for balance update is required' });
  }
  
  try {
    // Get current user info
    const [userRows] = await pool.query('SELECT id, full_name, balance FROM users WHERE id = ?', [id]);
    if (userRows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const oldBalance = userRows[0].balance;
    
    // Update balance
    await pool.query('UPDATE users SET balance = ?, updated_at = NOW() WHERE id = ?', [balance, id]);
    
    // Log admin action
    await pool.query(
      'INSERT INTO admin_logs (admin_id, action, details, created_at) VALUES (?, ?, ?, NOW())',
      [adminId, 'update_user_balance', `Updated balance for ${userRows[0].full_name} (ID: ${id}) from ${oldBalance} to ${balance}. Reason: ${reason}`]
    );
    
    res.json({ 
      message: 'User balance updated successfully',
      old_balance: parseFloat(oldBalance),
      new_balance: parseFloat(balance)
    });
  } catch (error) {
    console.error('Error updating user balance:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const createUser = async (req, res) => {
  const { email, password, full_name, phone } = req.body;
  const adminId = req.user.id;
  
  if (!email || !password || !full_name) {
    return res.status(400).json({ message: 'Email, password, and full name are required' });
  }
  
  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters long' });
  }
  
  try {
    // Check if email already exists
    const [existingUsers] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUsers.length > 0) {
      return res.status(400).json({ message: 'Email already registered' });
    }
    
    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Generate referral code
    const referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    // Insert user
    const [result] = await pool.query(
      'INSERT INTO users (email, password_hash, full_name, phone, referral_code, status, balance, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [email, hashedPassword, full_name, phone || null, referralCode, 'active', 0, 'user']
    );
    
    const newUserId = result.insertId;
    
    // Log admin action
    await pool.query(
      'INSERT INTO admin_logs (admin_id, action, details, created_at) VALUES (?, ?, ?, NOW())',
      [adminId, 'create_user', `Created new user: ${full_name} (${email}) with ID: ${newUserId}`]
    );
    
    res.status(201).json({ 
      message: 'User created successfully',
      user: {
        id: newUserId,
        email,
        full_name,
        phone,
        referral_code: referralCode,
        status: 'active',
        balance: 0
      }
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const deleteUser = async (req, res) => {
  const { id } = req.params;
  const { force = false } = req.query;
  const adminId = req.user.id;
  
  try {
    // Get user info
    const [userRows] = await pool.query('SELECT id, full_name, email, balance FROM users WHERE id = ?', [id]);
    if (userRows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const user = userRows[0];
    
    // Check if user has balance and force delete is not enabled
    if (user.balance > 0 && !force) {
      return res.status(400).json({ 
        message: 'Cannot delete user with positive balance. Use force=true to override.',
        user_balance: parseFloat(user.balance)
      });
    }
    
    // Check for related records
    const [referralCount] = await pool.query('SELECT COUNT(*) as count FROM referrals WHERE referrer_id = ? OR referred_id = ?', [id, id]);
    const [transactionCount] = await pool.query('SELECT COUNT(*) as count FROM transactions WHERE user_id = ?', [id]);
    
    if ((referralCount[0].count > 0 || transactionCount[0].count > 0) && !force) {
      return res.status(400).json({ 
        message: 'Cannot delete user with existing referrals or transactions. Use force=true to override.',
        related_records: {
          referrals: referralCount[0].count,
          transactions: transactionCount[0].count
        }
      });
    }
    
    // Delete user (this should cascade to related records if properly set up)
    await pool.query('DELETE FROM users WHERE id = ?', [id]);
    
    // Log admin action
    await pool.query(
      'INSERT INTO admin_logs (admin_id, action, details, created_at) VALUES (?, ?, ?, NOW())',
      [adminId, 'delete_user', `Deleted user: ${user.full_name} (${user.email}) with ID: ${id}${force ? ' (FORCED)' : ''}`]
    );
    
    res.json({ 
      message: 'User deleted successfully',
      deleted_user: {
        id: user.id,
        name: user.full_name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const getUserStats = async (req, res) => {
  try {
    const [stats] = await pool.query(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_users,
        COUNT(CASE WHEN status = 'suspended' THEN 1 END) as suspended_users,
        COUNT(CASE WHEN status = 'inactive' THEN 1 END) as inactive_users,
        COALESCE(SUM(balance), 0) as total_balance,
        COALESCE(AVG(balance), 0) as average_balance,
        COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as new_users_last_30_days,
        COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as new_users_last_7_days
      FROM users
    `);
    
    res.json({ stats: stats[0] });
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  registerUser,
  loginUser,
  verifyEmail,
  resendVerificationEmail,
  checkEmailVerificationStatus,
  getUserProfile,
  updateProfile,
  changePassword,
  // Admin functions
  getAllUsers,
  getUserById,
  updateUserStatus,
  updateUserBalance,
  createUser,
  deleteUser,
  getUserStats
};
