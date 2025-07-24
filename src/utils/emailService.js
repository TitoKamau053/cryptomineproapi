const nodemailer = require('nodemailer');
const pool = require('../db');

// Get system setting helper
const getSystemSetting = async (settingKey, defaultValue = null) => {
  try {
    const [rows] = await pool.query('SELECT setting_value, data_type FROM system_settings WHERE setting_key = ?', [settingKey]);
    if (rows.length > 0) {
      const { setting_value, data_type } = rows[0];
      
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
    return defaultValue;
  } catch (error) {
    console.error(`Error getting setting ${settingKey}:`, error);
    return defaultValue;
  }
};

// Create reusable transporter object using system settings
const createTransporter = async () => {
  const host = await getSystemSetting('smtp_host', process.env.SMTP_HOST || 'smtp.gmail.com');
  const port = await getSystemSetting('smtp_port', parseInt(process.env.SMTP_PORT) || 587);
  const secure = await getSystemSetting('smtp_secure', false);
  const username = await getSystemSetting('smtp_username', process.env.SMTP_USERNAME || '');
  const password = await getSystemSetting('smtp_password', process.env.SMTP_PASSWORD || '');

  return nodemailer.createTransporter({
    host,
    port,
    secure,
    auth: {
      user: username,
      pass: password,
    },
    tls: {
      rejectUnauthorized: false // For development - remove in production
    }
  });
};

// Email templates
const emailTemplates = {
  verification: {
    subject: 'Verify Your CryptoMinePro Account',
    html: (name, verificationLink) => `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Verify Your Account</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; background: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .button:hover { background: #218838; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
          .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🚀 Welcome to CryptoMinePro!</h1>
            <p>Your Gateway to Cryptocurrency Mining Success</p>
          </div>
          <div class="content">
            <h2>Hello ${name}!</h2>
            <p>Thank you for joining CryptoMinePro, the leading platform for cryptocurrency mining investments. We're excited to have you on board!</p>
            
            <p>To complete your registration and start earning, please verify your email address by clicking the button below:</p>
            
            <div style="text-align: center;">
              <a href="${verificationLink}" class="button">✅ Verify My Email</a>
            </div>
            
            <div class="warning">
              <strong>⚠️ Important:</strong> This verification link will expire in 24 hours. If you don't verify your account within this time, you'll need to request a new verification email.
            </div>
            
            <p>Once verified, you'll be able to:</p>
            <ul>
              <li>💰 Start mining cryptocurrency</li>
              <li>💸 Make deposits and withdrawals</li>
              <li>🤝 Earn from our referral program</li>
              <li>📊 Access your dashboard and earnings</li>
            </ul>
            
            <p>If the button doesn't work, copy and paste this link into your browser:</p>
            <p style="word-break: break-all; background: #e9ecef; padding: 10px; border-radius: 5px; font-family: monospace;">
              ${verificationLink}
            </p>
            
            <p>If you didn't create this account, please ignore this email.</p>
            
            <p>Best regards,<br>
            <strong>The CryptoMinePro Team</strong></p>
          </div>
          <div class="footer">
            <p>© 2025 CryptoMinePro. All rights reserved.</p>
            <p>Need help? Contact us at support@cryptominepro.com</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: (name, verificationLink) => `
      Welcome to CryptoMinePro, ${name}!
      
      Thank you for joining our cryptocurrency mining platform. To complete your registration, please verify your email address.
      
      Click this link to verify: ${verificationLink}
      
      This link will expire in 24 hours.
      
      If you didn't create this account, please ignore this email.
      
      Best regards,
      The CryptoMinePro Team
    `
  },
  
  verificationSuccess: {
    subject: '🎉 Email Verified Successfully - Welcome to CryptoMinePro!',
    html: (name) => `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Welcome to CryptoMinePro</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; background: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .feature { background: white; padding: 20px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #28a745; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Email Verified Successfully!</h1>
            <p>Your CryptoMinePro account is now active</p>
          </div>
          <div class="content">
            <h2>Congratulations ${name}!</h2>
            <p>Your email has been successfully verified and your CryptoMinePro account is now fully activated. You can now access all platform features!</p>
            
            <div style="text-align: center;">
              <a href="${process.env.APP_BASE_URL || 'https://cryptominepro.com'}/login" class="button">🚀 Access Dashboard</a>
            </div>
            
            <h3>What's Next?</h3>
            
            <div class="feature">
              <h4>💰 Start Mining</h4>
              <p>Browse our mining engines and choose the perfect investment plan for your goals.</p>
            </div>
            
            <div class="feature">
              <h4>💸 Make Your First Deposit</h4>
              <p>Fund your account securely via M-Pesa and start earning immediately.</p>
            </div>
            
            <div class="feature">
              <h4>🤝 Invite Friends</h4>
              <p>Use your unique referral code to earn commissions when friends join CryptoMinePro.</p>
            </div>
            
            <div class="feature">
              <h4>📊 Track Earnings</h4>
              <p>Monitor your daily mining rewards and total portfolio growth in real-time.</p>
            </div>
            
            <p>Need help getting started? Our support team is here to assist you at support@cryptominepro.com</p>
            
            <p>Happy mining!<br>
            <strong>The CryptoMinePro Team</strong></p>
          </div>
          <div class="footer">
            <p>© 2025 CryptoMinePro. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: (name) => `
      Email Verified Successfully!
      
      Congratulations ${name}! Your CryptoMinePro account is now fully activated.
      
      You can now:
      - Start mining cryptocurrency
      - Make deposits and withdrawals
      - Earn from referrals
      - Access your dashboard
      
      Login at: ${process.env.APP_BASE_URL || 'https://cryptominepro.com'}/login
      
      Welcome to CryptoMinePro!
      The CryptoMinePro Team
    `
  }
};

// Send verification email
const sendVerificationEmail = async (email, name, verificationToken) => {
  try {
    const transporter = await createTransporter();
    const fromAddress = await getSystemSetting('email_from_address', 'noreply@cryptominepro.com');
    const fromName = await getSystemSetting('email_from_name', 'CryptoMinePro');
    
    const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
    const verificationLink = `${baseUrl}/api/users/verify-email?token=${verificationToken}`;
    
    const mailOptions = {
      from: `"${fromName}" <${fromAddress}>`,
      to: email,
      subject: emailTemplates.verification.subject,
      text: emailTemplates.verification.text(name, verificationLink),
      html: emailTemplates.verification.html(name, verificationLink),
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Verification email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending verification email:', error);
    return { success: false, error: error.message };
  }
};

// Send welcome email after verification
const sendWelcomeEmail = async (email, name) => {
  try {
    const transporter = await createTransporter();
    const fromAddress = await getSystemSetting('email_from_address', 'noreply@cryptominepro.com');
    const fromName = await getSystemSetting('email_from_name', 'CryptoMinePro');
    
    const mailOptions = {
      from: `"${fromName}" <${fromAddress}>`,
      to: email,
      subject: emailTemplates.verificationSuccess.subject,
      text: emailTemplates.verificationSuccess.text(name),
      html: emailTemplates.verificationSuccess.html(name),
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Welcome email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending welcome email:', error);
    return { success: false, error: error.message };
  }
};

// Test email configuration
const testEmailConfiguration = async () => {
  try {
    const transporter = await createTransporter();
    await transporter.verify();
    console.log('Email configuration is valid');
    return { success: true, message: 'Email configuration is valid' };
  } catch (error) {
    console.error('Email configuration error:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendVerificationEmail,
  sendWelcomeEmail,
  testEmailConfiguration,
  getSystemSetting
};
