const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendVerificationEmail, sendWelcomeEmail } = require('../utils/emailService');

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// Generate secure verification token
const generateVerificationToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Generate unique referral code
const generateReferralCode = () => {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
};

// Register new user
const register = async (req, res) => {
  const { email, password, full_name, phone, referral_code } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    // Check if user already exists
    const [existingUsers] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUsers.length > 0) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // Hash password
    const saltRounds = 12;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Handle referral
    let referred_by = null;
    if (referral_code) {
      const [referrer] = await pool.query('SELECT id FROM users WHERE referral_code = ?', [referral_code]);
      if (referrer.length > 0) {
        referred_by = referrer[0].id;
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

    // Create user
    const [result] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, phone, referral_code, referred_by, email_verified, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, FALSE, CURRENT_TIMESTAMP)`,
      [email, password_hash, full_name || null, phone || null, userReferralCode, referred_by]
    );

    const userId = result.insertId;

    // Generate verification token
    const verificationToken = generateVerificationToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Save verification token
    await pool.query(
      'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [userId, verificationToken, expiresAt]
    );

    // Send verification email
    await sendVerificationEmail(email, full_name, verificationToken);

    res.status(201).json({
      message: 'Registration successful. Please check your email to verify your account.',
      userId: userId
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Login user
const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    // Get user from database
    const [users] = await pool.query(
      'SELECT id, email, password_hash, full_name, role, status, email_verified FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = users[0];

    // Check password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Check if account is active
    if (user.status !== 'active') {
      return res.status(401).json({ message: 'Account is suspended' });
    }

    // Check email verification (except for admins)
    if (!user.email_verified && user.role !== 'admin') {
      return res.status(401).json({ message: 'Email not verified' });
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
        role: user.role,
        email_verified: user.email_verified
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Verify email
const verifyEmail = async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ message: 'Verification token is required' });
  }

  try {
    // Find valid token
    const [tokens] = await pool.query(
      `SELECT evt.user_id, u.email, u.full_name 
       FROM email_verification_tokens evt 
       JOIN users u ON evt.user_id = u.id 
       WHERE evt.token = ? AND evt.expires_at > NOW()`,
      [token]
    );

    if (tokens.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired verification token' });
    }

    const { user_id, email, full_name } = tokens[0];

    // Check if already verified
    const [users] = await pool.query('SELECT email_verified FROM users WHERE id = ?', [user_id]);
    if (users[0].email_verified) {
      return res.status(400).json({ message: 'Email is already verified' });
    }

    // Mark user as verified
    await pool.query(
      'UPDATE users SET email_verified = TRUE, email_verified_at = CURRENT_TIMESTAMP WHERE id = ?',
      [user_id]
    );

    // Delete the verification token
    await pool.query('DELETE FROM email_verification_tokens WHERE token = ?', [token]);

    // Send welcome email
    await sendWelcomeEmail(email, full_name);

    res.json({ message: 'Email verified successfully' });

  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Resend verification email
const resendVerification = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  try {
    // Find user
    const [users] = await pool.query(
      'SELECT id, email, full_name, email_verified FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = users[0];

    if (user.email_verified) {
      return res.status(400).json({ message: 'Email is already verified' });
    }

    // Delete any existing tokens for this user
    await pool.query('DELETE FROM email_verification_tokens WHERE user_id = ?', [user.id]);

    // Generate new verification token
    const verificationToken = generateVerificationToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Save new verification token
    await pool.query(
      'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, verificationToken, expiresAt]
    );

    // Send verification email
    await sendVerificationEmail(user.email, user.full_name, verificationToken);

    res.json({ message: 'Verification email sent successfully' });

  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Get user profile (protected route)
const getUserProfile = async (req, res) => {
  const userId = req.user.id;

  try {
    const [userRows] = await pool.query(
      `SELECT id, email, full_name, phone, role, balance, total_earnings, referral_code, status, 
              email_verified, email_verified_at, last_login, created_at 
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
        email_verified: user.email_verified,
        email_verified_at: user.email_verified_at,
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
  verifyEmail,
  resendVerification,
  getUserProfile
};
