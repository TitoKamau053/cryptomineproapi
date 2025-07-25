const jwt = require('jsonwebtoken');
const pool = require('../db');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ message: 'No token provided' });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database
    const [userRows] = await pool.query(
      'SELECT id, email, full_name, role, status, email_verified FROM users WHERE id = ?',
      [decoded.userId]
    );

    if (userRows.length === 0) {
      return res.status(401).json({ message: 'User not found' });
    }

    const user = userRows[0];

    // Check if user is active
    if (user.status !== 'active') {
      return res.status(401).json({ message: 'Account is suspended' });
    }

    req.user = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      status: user.status,
      email_verified: user.email_verified
    };
    
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    return res.status(403).json({ message: 'Failed to authenticate token' });
  }
};

module.exports = { verifyToken };
