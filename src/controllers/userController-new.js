const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { isValidKenyanPhone, formatPhoneForDisplay } = require('../utils/phoneUtils');

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// Generate unique referral code
const generateReferralCode = () => {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
};

// Register new user
const register = async (req, res) => {
  const { email, password, full_name, phone, referral_code } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ message: 'Phone number and password are required' });
  }

  // Validate phone number format
  if (!isValidKenyanPhone(phone)) {
    return res.status(400).json({ 
      message: 'Invalid phone number format. Use 0711111111 or 0111111111 format' 
    });
  }

  try {
    // Format phone number for consistency
    const formattedPhone = formatPhoneForDisplay(phone);

    // Check if user already exists by phone number
    const [existingUsers] = await pool.query('SELECT id FROM users WHERE phone = ?', [formattedPhone]);
    if (existingUsers.length > 0) {
      return res.status(400).json({ message: 'User already exists with this phone number' });
    }

    // Hash password
    const saltRounds = 12;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Handle referral (always uppercase and trim code)
    let referred_by = null;
    let referrerRow = null;
    if (referral_code) {
      const code = referral_code.trim().toUpperCase();
      const [referrer] = await pool.query('SELECT id FROM users WHERE UPPER(referral_code) = ?', [code]);
      if (referrer.length > 0) {
        referred_by = referrer[0].id;
        referrerRow = referrer[0];
      }
    }

    // Generate unique referral code for new user
    let userReferralCode;
    let isUnique = false;
    while (!isUnique) {
      userReferralCode = generateReferralCode();
      const [existing] = await pool.query('SELECT id FROM users WHERE referral_code = ?', [userReferralCode]);
      if (existing.length === 0) {
        isUnique = true;
      }
    }

    // Create user with email verification set to TRUE (no email verification required)
    const [result] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, phone, referral_code, referred_by, email_verified, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP)`,
      [email || null, password_hash, full_name || null, formattedPhone, userReferralCode, referred_by]
    );

    const userId = result.insertId;

    // If referred, insert into referrals table for network tracking
    if (referred_by) {
      await pool.query(
        'INSERT INTO referrals (referrer_id, referred_id, created_at) VALUES (?, ?, NOW())',
        [referred_by, userId]
      );
    }

    res.status(201).json({
      message: 'Registration successful. You can now login.',
      userId: userId
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Login user
const login = async (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ message: 'Phone number and password are required' });
  }

  // Validate phone number format
  if (!isValidKenyanPhone(phone)) {
    return res.status(400).json({ 
      message: 'Invalid phone number format. Use 0711111111 or 0111111111 format' 
    });
  }

  try {
    // Format phone number for consistency
    const formattedPhone = formatPhoneForDisplay(phone);

    // Get user from database
    const [users] = await pool.query(
      'SELECT id, email, password_hash, full_name, role, status, phone FROM users WHERE phone = ?',
      [formattedPhone]
    );

    if (users.length === 0) {
      return res.status(401).json({ message: 'Invalid phone number or password' });
    }

    const user = users[0];

    // Check password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid phone number or password' });
    }

    // Check if account is active
    if (user.status !== 'active') {
      return res.status(401).json({ message: 'Account is suspended' });
    }

    // Update last login
    await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

    // Generate JWT token
    const token = generateToken(user.id);

    res.json({
      message: 'Login successful',
      token: token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        phone: user.phone,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Get user profile (protected route)
const getUserProfile = async (req, res) => {
  const userId = req.user.id;

  try {
    const [userRows] = await pool.query(
      `SELECT id, email, full_name, phone, role, balance, total_earnings, referral_code, status, 
              last_login, created_at 
       FROM users WHERE id = ?`,
      [userId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userRows[0];
    res.json({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        phone: user.phone,
        role: user.role,
        balance: user.balance,
        total_earnings: user.total_earnings,
        referral_code: user.referral_code,
        status: user.status,
        last_login: user.last_login,
        created_at: user.created_at
      }
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  register,
  login,
  getUserProfile
};
