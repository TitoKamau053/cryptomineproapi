require('dotenv').config();
const nodemailer = require('nodemailer');

// Create email transporter using environment variables
const createTransporter = async () => {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT) || 587;
  const secure = port === 465; // true for 465, false for other ports
  const username = process.env.SMTP_USER || '';
  const password = process.env.SMTP_PASS || '';

  console.log('Email config:', { host, port, secure, username: username ? '***set***' : 'missing', password: password ? '***set***' : 'missing' });

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

// Send verification email
const sendVerificationEmail = async (email, name, verificationToken) => {
  try {
    const transporter = await createTransporter();
    const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'noreply@cryptominepro.com';
    const fromName = process.env.EMAIL_FROM_NAME || 'CryptoMinePro';
    
    // Use the APP_BASE_URL for frontend verification
    const appBaseUrl = process.env.APP_BASE_URL;
    const verificationLink = `${appBaseUrl}/verify-email?token=${verificationToken}`;
    
    const mailOptions = {
      from: `"${fromName}" <${fromAddress}>`,
      to: email,
      subject: 'Verify Your CryptoMinePro Account',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Verify Your Email</title>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; margin: 0; padding: 20px; background-color: #f4f4f4; }
              .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 0 10px rgba(0,0,0,.1); }
              .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; }
              .content { padding: 30px; }
              .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
              .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 12px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Welcome to CryptoMinePro!</h1>
              </div>
              <div class="content">
                <h2>Hello ${name || 'User'},</h2>
                <p>Thank you for registering with CryptoMinePro. To complete your registration, please verify your email address by clicking the button below:</p>
                <div style="text-align: center;">
                  <a href="${verificationLink}" class="button">Verify Email Address</a>
                </div>
                <p>If the button doesn't work, you can also copy and paste this link into your browser:</p>
                <p style="word-break: break-all; color: #667eea;">${verificationLink}</p>
                <p><strong>This verification link will expire in 24 hours.</strong></p>
                <p>If you didn't create an account with CryptoMinePro, please ignore this email.</p>
              </div>
              <div class="footer">
                <p>© ${new Date().getFullYear()} CryptoMinePro. All rights reserved.</p>
                <p>This is an automated email, please do not reply.</p>
              </div>
            </div>
          </body>
        </html>
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Verification email sent successfully:', result.messageId);
    return result;
  } catch (error) {
    console.error('Error sending verification email:', error);
    throw error;
  }
};

// Send welcome email after verification
const sendWelcomeEmail = async (email, name) => {
  try {
    const transporter = await createTransporter();
    const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'noreply@cryptominepro.com';
    const fromName = process.env.EMAIL_FROM_NAME || 'CryptoMinePro';
    
    const mailOptions = {
      from: `"${fromName}" <${fromAddress}>`,
      to: email,
      subject: 'Welcome to CryptoMinePro - Let\'s Start Mining!',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Welcome to CryptoMinePro</title>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; margin: 0; padding: 20px; background-color: #f4f4f4; }
              .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 0 10px rgba(0,0,0,.1); }
              .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; }
              .content { padding: 30px; }
              .button { display: inline-block; background: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
              .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 12px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🎉 Welcome to CryptoMinePro!</h1>
              </div>
              <div class="content">
                <h2>Hello ${name || 'User'},</h2>
                <p>Your email has been successfully verified! Welcome to the CryptoMinePro community.</p>
                <p>You can now:</p>
                <ul>
                  <li>Browse and purchase mining engines</li>
                  <li>Start earning daily returns</li>
                  <li>Track your earnings and withdrawals</li>
                  <li>Refer friends and earn commissions</li>
                </ul>
                <div style="text-align: center;">
                  <a href="${process.env.APP_BASE_URL}/dashboard" class="button">Go to Dashboard</a>
                </div>
                <p>If you have any questions, our support team is here to help!</p>
              </div>
              <div class="footer">
                <p>© ${new Date().getFullYear()} CryptoMinePro. All rights reserved.</p>
              </div>
            </div>
          </body>
        </html>
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Welcome email sent successfully:', result.messageId);
    return result;
  } catch (error) {
    console.error('Error sending welcome email:', error);
    throw error;
  }
};

// Test email configuration
const testEmailConfiguration = async () => {
  try {
    const transporter = await createTransporter();
    
    // Verify connection configuration
    await transporter.verify();
    console.log('✅ Email server is ready to take our messages');
    return true;
  } catch (error) {
    console.error('❌ Email configuration error:', error);
    return false;
  }
};

module.exports = {
  sendVerificationEmail,
  sendWelcomeEmail,
  testEmailConfiguration
};
