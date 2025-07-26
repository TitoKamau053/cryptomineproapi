const pool = require('../db');

const getReferralCommissions = async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;
  
  try {
    // Get commission history - removed investments table JOIN since it doesn't exist
    const [commissions] = await pool.query(`
      SELECT rc.id, 
             rc.commission_amount, 
             'referral_commission' as commission_type, 
             rc.commission_date as created_at,
             rc.status,
             r.referred_id, 
             u.full_name as referred_name, 
             u.email as referred_email,
             rc.purchase_id,
             NULL as investment_amount,
             NULL as engine_id,
             NULL as investment_status
      FROM referral_commissions rc
      JOIN referrals r ON rc.referral_id = r.id
      JOIN users u ON r.referred_id = u.id
      WHERE r.referrer_id = ?
      ORDER BY rc.commission_date DESC, rc.created_at DESC
      LIMIT ? OFFSET ?
    `, [userId, parseInt(limit), parseInt(offset)]);
    
    // Get total count
    const [countResult] = await pool.query(`
      SELECT COUNT(*) as total
      FROM referral_commissions rc
      JOIN referrals r ON rc.referral_id = r.id
      WHERE r.referrer_id = ?
    `, [userId]);
    
    const total = countResult[0].total;
    
    res.json({
      commissions: commissions || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total || 0,
        pages: Math.ceil((total || 0) / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching referral commissions:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage
    });
    
    // Return empty result instead of error to prevent UI crashes
    res.json({
      commissions: [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: 0,
        pages: 0
      },
      error: 'Unable to fetch commission data'
    });
  }
};

const getReferralInfo = async (req, res) => {
  const userId = req.user.id;
  try {
    // Get referral information using the correct referrals table structure
    const [rows] = await pool.query(`
      SELECT r.id as referral_id, 
             r.commission_rate, 
             r.total_commission, 
             r.status, 
             r.created_at as referral_date,
             u.email as referred_email, 
             u.full_name as referred_name, 
             u.created_at as referred_date,
             COALESCE(SUM(CASE WHEN rc.status = 'paid' THEN rc.commission_amount ELSE 0 END), 0) as total_commission_earned,
             COALESCE(SUM(CASE WHEN rc.status = 'pending' THEN rc.commission_amount ELSE 0 END), 0) as pending_commission,
             COUNT(rc.id) as commission_count
      FROM referrals r 
      JOIN users u ON r.referred_id = u.id 
      LEFT JOIN referral_commissions rc ON rc.referral_id = r.id 
      WHERE r.referrer_id = ? 
      GROUP BY r.id, u.email, u.full_name, u.created_at, r.commission_rate, r.total_commission, r.status, r.created_at
      ORDER BY r.created_at DESC
    `, [userId]);
    
    const referrals = rows;
    
    // Get referral statistics
    const [statsRows] = await pool.query(`
      SELECT COUNT(DISTINCT r.id) as total_referrals,
             COUNT(DISTINCT CASE WHEN r.status = 'active' THEN r.id END) as active_referrals,
             COALESCE(SUM(CASE WHEN rc.status = 'paid' THEN rc.commission_amount ELSE 0 END), 0) as total_commissions_earned,
             COALESCE(SUM(CASE WHEN rc.status = 'pending' THEN rc.commission_amount ELSE 0 END), 0) as pending_commissions,
             COALESCE(AVG(CASE WHEN rc.status = 'paid' THEN rc.commission_amount END), 0) as avg_commission_per_referral,
             COALESCE(SUM(r.total_commission), 0) as lifetime_commissions
      FROM referrals r 
      LEFT JOIN referral_commissions rc ON rc.referral_id = r.id 
      WHERE r.referrer_id = ?
    `, [userId]);
    
    const statistics = statsRows[0] || {
      total_referrals: 0,
      active_referrals: 0,
      total_commissions_earned: 0,
      pending_commissions: 0,
      avg_commission_per_referral: 0,
      lifetime_commissions: 0
    };
    
    res.json({ 
      referrals: referrals || [],
      statistics
    });
    
  } catch (error) {
    console.error('Error fetching referral info:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      sqlState: error.sqlState
    });
    
    // Return empty data instead of error
    res.json({ 
      referrals: [],
      statistics: {
        total_referrals: 0,
        active_referrals: 0,
        total_commissions_earned: 0,
        pending_commissions: 0,
        avg_commission_per_referral: 0,
        lifetime_commissions: 0
      },
      error: 'Unable to fetch referral data'
    });
  }
};

const generateReferralLink = async (req, res) => {
  const userId = req.user.id;
  try {
    // Get user's referral code
    const [userRows] = await pool.query(
      'SELECT referral_code, full_name FROM users WHERE id = ?',
      [userId]
    );
    
    if (userRows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const { referral_code, full_name } = userRows[0];
    
    // Generate shareable link by combining referral code with frontend registration URL
    const backendUrl = process.env.APP_BASE_URL;
    const frontendUrl = process.env.FRONTEND_URL;
    const referralLink = `${frontendUrl}/register?ref=${referral_code}`;
    const shortReferralLink = `${backendUrl}/ref/${referral_code}`; // Short link redirects through backend
    
    // Get referral statistics
    const [statsRows] = await pool.query(
      "SELECT COUNT(*) as total_referrals, " +
      "COALESCE(SUM(rc.commission_amount), 0) as total_commissions " +
      "FROM referrals r " +
      "LEFT JOIN referral_commissions rc ON rc.referral_id = r.id " +
      "WHERE r.referrer_id = ?",
      [userId]
    );
    
    const stats = statsRows[0];
    
    res.json({
      success: true,
      data: {
        referral_code,
        referral_link: referralLink,
        short_referral_link: shortReferralLink,
        share_message: `Join ${full_name} on CryptoMinePro and start earning through cryptocurrency mining! Use my referral link: ${shortReferralLink}`,
        stats: {
          total_referrals: stats.total_referrals,
          total_commissions: parseFloat(stats.total_commissions)
        }
      }
    });
  } catch (error) {
    console.error('Error generating referral link:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const getMyReferrer = async (req, res) => {
  const userId = req.user.id;
  
  try {
    // Get user's referrer information
    const [userRows] = await pool.query(`
      SELECT u.referred_by, r.full_name as referrer_name, r.email as referrer_email,
             r.referral_code as referrer_code
      FROM users u
      LEFT JOIN users r ON u.referred_by = r.id
      WHERE u.id = ?
    `, [userId]);
    
    if (userRows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const user = userRows[0];
    
    if (!user.referred_by) {
      return res.json({ 
        message: 'No referrer found',
        referrer: null
      });
    }
    
    res.json({
      referrer: {
        id: user.referred_by,
        name: user.referrer_name,
        email: user.referrer_email,
        referral_code: user.referrer_code
      }
    });
  } catch (error) {
    console.error('Error fetching referrer info:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Validate referral code (public endpoint for frontend signup)
const validateReferralCode = async (req, res) => {
  const { referral_code } = req.params;
  
  try {
    if (!referral_code) {
      return res.status(400).json({ 
        valid: false,
        message: 'Referral code is required' 
      });
    }
    
    // Check if referral code exists and get referrer info
    const [referrerRows] = await pool.query(`
      SELECT id, full_name, email, referral_code, created_at,
             (SELECT COUNT(*) FROM users WHERE referred_by = users.id) as total_referrals
      FROM users 
      WHERE referral_code = ? AND status = 'active'
    `, [referral_code.toUpperCase()]);
    
    if (referrerRows.length === 0) {
      return res.json({ 
        valid: false,
        message: 'Invalid referral code'
      });
    }
    
    const referrer = referrerRows[0];
    
    res.json({
      valid: true,
      message: 'Valid referral code',
      referrer: {
        id: referrer.id,
        name: referrer.full_name,
        email: referrer.email,
        referral_code: referrer.referral_code,
        total_referrals: referrer.total_referrals,
        member_since: new Date(referrer.created_at).toLocaleDateString('en-KE', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
      }
    });
  } catch (error) {
    console.error('Error validating referral code:', error);
    res.status(500).json({ 
      valid: false,
      message: 'Internal server error' 
    });
  }
};

module.exports = {
  getReferralInfo,
  generateReferralLink,
  getReferralCommissions,
  getMyReferrer,
  validateReferralCode
};
