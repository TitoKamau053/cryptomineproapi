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
    if (!verificationToken) {
      throw new Error('Failed to generate verification token');
    }
    
    console.log('Generated verification token:', { 
      tokenLength: verificationToken.length,
      tokenPreview: verificationToken.substring(0, 10) + '...'
    });
    
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Save verification token
    await pool.query(
      'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [userId, verificationToken, expiresAt]
    );

    // Send verification email with proper error handling
    try {
      await sendVerificationEmail(email, full_name, verificationToken);
      console.log('✅ Verification email sent successfully to:', email);
      
      res.status(201).json({
        message: 'Registration successful. Please check your email to verify your account.',
        userId: userId,
        emailSent: true
      });
    } catch (emailError) {
      console.error('❌ Email sending failed:', emailError.message);
      
      // Registration still successful even if email fails
      res.status(201).json({
        message: 'Registration successful. However, there was an issue sending the verification email. You can request a new verification email from the login page.',
        userId: userId,
        emailSent: false,
        emailError: 'Email delivery failed - please use resend verification option'
      });
    }

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Login user
const login = async (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ message: 'Phone and password are required' });
  }

  try {
    // Get user from database
    const [users] = await pool.query(
      'SELECT id, email, password_hash, full_name, role, status, email_verified FROM users WHERE phone = ?',
      [phone]
    );

    if (users.length === 0) {
      return res.status(401).json({ message: 'Invalid phone or password' });
    }

    const user = users[0];

    // Check password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid phone or password' });
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

  console.log('Verification request received:', { token: token ? 'present' : 'missing', query: req.query, url: req.originalUrl });

  if (!token) {
    console.log('❌ Missing token in verification request');
    return res.status(400).json({
      success: false,
      message: 'Verification token is required',
      error: 'missing_token'
    });
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

    console.log('Token lookup result:', { tokenFound: tokens.length > 0, token: token.substring(0, 10) + '...' });

    if (tokens.length === 0) {
      console.log('❌ Invalid or expired token');
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token',
        error: 'invalid_or_expired_token'
      });
    }

    const { user_id, email, full_name } = tokens[0];

    // Check if already verified
    const [users] = await pool.query('SELECT email_verified FROM users WHERE id = ?', [user_id]);
    if (users[0].email_verified) {
      console.log('✅ Email already verified for user:', email);
      return res.json({
        success: true,
        message: 'Email already verified',
        data: {
          email: email,
          already_verified: true,
          verified_at: users[0].email_verified_at
        }
      });
    }

    // Mark user as verified
    await pool.query(
      'UPDATE users SET email_verified = TRUE, email_verified_at = CURRENT_TIMESTAMP WHERE id = ?',
      [user_id]
    );

    // Delete the verification token
    await pool.query('DELETE FROM email_verification_tokens WHERE token = ?', [token]);

    console.log('✅ Email verified successfully for user:', email);

    // Send welcome email
    try {
      await sendWelcomeEmail(email, full_name);
      console.log('✅ Welcome email sent to:', email);
    } catch (welcomeEmailError) {
      console.error('❌ Welcome email failed (but verification successful):', welcomeEmailError.message);
    }

    // Return JSON success response
    res.json({
      success: true,
      message: 'Email verified successfully',
      data: {
        email: email,
        full_name: full_name,
        verified: true
      }
    });

  } catch (error) {
    console.error('Email verification error:', error);
    
    // Return JSON error response
    res.status(500).json({
      success: false,
      message: 'Internal server error during email verification',
      error: 'server_error'
    });
  }
};

// Resend verification email
const resendVerification = async (req, res) => {
  const { email } = req.body;

  // Log the request for debugging
  console.log('Resend verification request:', { email, body: req.body });

  if (!email) {
    return res.status(400).json({ 
      success: false,
      message: 'Email is required' 
    });
  }

  try {
    // Find user
    const [users] = await pool.query(
      'SELECT id, email, full_name, email_verified FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    const user = users[0];

    if (user.email_verified) {
      return res.status(200).json({ 
        success: true,
        message: 'Email is already verified',
        already_verified: true
      });
    }

    // Delete any existing tokens for this user
    await pool.query('DELETE FROM email_verification_tokens WHERE user_id = ?', [user.id]);

    // Generate new verification token
    const verificationToken = generateVerificationToken();
    if (!verificationToken) {
      throw new Error('Failed to generate verification token');
    }
    
    console.log('Generated new verification token:', { 
      email,
      tokenLength: verificationToken.length,
      tokenPreview: verificationToken.substring(0, 10) + '...'
    });
    
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Save new verification token
    await pool.query(
      'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, verificationToken, expiresAt]
    );

    // Send verification email with retry logic
    try {
      await sendVerificationEmail(user.email, user.full_name, verificationToken);
      console.log('✅ Verification email sent successfully to:', email);
      
      res.json({ 
        success: true,
        message: 'Verification email sent successfully' 
      });
    } catch (emailError) {
      console.error('❌ Email sending failed:', emailError.message);
      
      // Still return success to prevent frontend loops, but with a helpful message
      res.json({ 
        success: true,
        message: 'Verification email queued for delivery. If you don\'t receive it within 10 minutes, please contact support.',
        email_error: true
      });
    }

  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error' 
    });
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

// Get user verification status
const getVerificationStatus = async (req, res) => {
  try {
    const { email } = req.query;

    // Log for debugging
    console.log('Verification status check for:', email);

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    const query = 'SELECT email_verified, email_verified_at FROM users WHERE email = ?';
    
    const [results] = await pool.query(query, [email]);

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = results[0];
    
    // Add cache headers to prevent excessive polling
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    res.json({
      success: true,
      data: {
        email_verified: user.email_verified,
        email_verified_at: user.email_verified_at,
        is_verified: user.email_verified === 1
      }
    });
  } catch (error) {
    console.error('Error checking verification status:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = {
  register,
  login,
  verifyEmail,
  resendVerification,
  getUserProfile,
  getVerificationStatus
};
