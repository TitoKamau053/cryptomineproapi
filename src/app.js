require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors({
  origin: [
    'https://cryptominepro.vercel.app',
    'http://localhost:5173',
    'https://minershub.pro',
    'http://localhost:5174'
  ],
  credentials: true,
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const userRoutes = require('./routes/userRoutes');
const miningEngineRoutes = require('./routes/miningEngineRoutes');
const depositRoutes = require('./routes/depositRoutes');
const withdrawalRoutes = require('./routes/withdrawalRoutes');
const purchaseRoutes = require('./routes/purchaseRoutes');
const earningRoutes = require('./routes/earningRoutes');
const referralRoutes = require('./routes/referralRoutes');
const adminRoutes = require('./routes/adminRoutes');
const mpesaRoutes = require('./routes/mpesaRoutes');
const transactionRoutes = require('./routes/transactionRoutes');

const { verifyToken } = require('./middleware/authMiddleware');
const { verifyAdminRole } = require('./middleware/adminMiddleware');

// Basic route for testing
app.get('/', (req, res) => {
  res.json({ 
    message: 'Welcome to MinersHub Pro API',
    version: '2.0.0',
    features: ['Exact Timing Mining Engines', 'Hourly & Daily Earnings', 'Real-time Processing'],
    status: 'operational'
  });
});

// Public routes
app.use('/api/users', userRoutes);
app.use('/api/mining-engines', miningEngineRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/earnings', earningRoutes);
app.use('/api/mpesa', mpesaRoutes);
app.use('/api/referrals', referralRoutes);

// Protected routes
app.use('/api/deposits', verifyToken, depositRoutes);
app.use('/api/withdrawals', verifyToken, withdrawalRoutes);
app.use('/api/transactions', verifyToken, transactionRoutes);

// Admin routes with admin role verification
app.use('/api/admin', verifyToken, verifyAdminRole, adminRoutes);

// Referral link redirect endpoint (redirects to frontend with referral code)
app.get('/ref/:referral_code', (req, res) => {
  const referralCode = req.params.referral_code.toUpperCase();
  const frontendUrl = process.env.FRONTEND_URL;
  res.redirect(`${frontendUrl}/register?ref=${referralCode}`);
});

// Enhanced manual earnings processing endpoint for admin testing
app.post('/api/admin/trigger-earnings', verifyToken, verifyAdminRole, async (req, res) => {
  try {
    const { intervalType, force = false, dryRun = false } = req.body;
    const { triggerManualProcessing } = require('./utils/cronJobs');
    
    const result = await triggerManualProcessing({
      intervalType, // 'hourly', 'daily', or null for all
      force,        // true to override running jobs
      dryRun        // true to simulate without processing
    });
    
    res.json({
      success: true,
      message: dryRun ? 'Dry run completed successfully' : 'Earnings processing triggered manually',
      admin_id: req.user.id,
      trigger_time: new Date().toISOString(),
      parameters: { intervalType, force, dryRun },
      result
    });
  } catch (error) {
    console.error('Manual trigger error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to trigger earnings processing',
      error: error.message,
      admin_id: req.user.id,
      trigger_time: new Date().toISOString()
    });
  }
});

// Enhanced system status endpoint for monitoring
app.get('/api/admin/system-status', verifyToken, verifyAdminRole, async (req, res) => {
  try {
    const { getJobStatus } = require('./utils/cronJobs');
    const status = getJobStatus();
    
    // Add database connection check
    const pool = require('./db');
    try {
      await pool.query('SELECT 1');
      status.database_status = 'connected';
    } catch (dbError) {
      status.database_status = 'error';
      status.database_error = dbError.message;
    }
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      system_status: status
    });
  } catch (error) {
    console.error('System status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get system status',
      error: error.message
    });
  }
});

// Debug endpoint to check purchase maturity schedules
app.get('/api/admin/debug/purchase/:purchaseId/schedule', verifyToken, verifyAdminRole, async (req, res) => {
  try {
    const { purchaseId } = req.params;
    const { getPurchaseMaturitySchedule } = require('./utils/miningEarningsProcessor');
    
    const schedule = await getPurchaseMaturitySchedule(purchaseId);
    
    res.json({
      success: true,
      purchase_id: parseInt(purchaseId),
      maturity_schedule: schedule,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Debug schedule error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get purchase maturity schedule',
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

// Only start server if not in test environment
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🚀 MinersHub Pro Server is running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📅 Started at: ${new Date().toISOString()}`);
    
    // Start the corrected earnings processing cron jobs
    try {
      const { startCronJobs } = require('./utils/cronJobs');
      startCronJobs();
      console.log('✅ Corrected cron jobs started successfully');
      console.log('   - Frequent earnings check: Every 5 minutes');
      console.log('   - Intensive earnings check: Every minute (6 AM - 11 PM)');
      console.log('   - Daily maintenance: 02:00 daily');
      console.log('   - Health check: Every 30 minutes');
    } catch (cronError) {
      console.error('❌ Failed to start cron jobs:', cronError);
      console.error('   Server will continue running, but earnings processing may not work correctly');
    }
    
    // Log system configuration
    console.log('\n📋 System Configuration:');
    console.log(`   - Timezone: Africa/Nairobi`);
    console.log(`   - Database: ${process.env.DB_HOST ? 'External' : 'Local'}`);
    console.log(`   - CORS Origins: ${app._router.stack.find(s => s.name === 'corsMiddleware') ? 'Configured' : 'Default'}`);
    console.log(`   - Mining Logic: Exact Timing (purchase_time + duration)`);
    console.log('\n🎯 Ready to process mining engines with exact timing!');
  });
} else {
  // For test environment, still export the app but don't start cron jobs
  console.log('🧪 Test environment detected - skipping server startup and cron jobs');
}

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT. Gracefully shutting down...');
  
  try {
    const { stopCronJobs } = require('./utils/cronJobs');
    const stoppedJobs = stopCronJobs();
    console.log(`✅ Stopped ${stoppedJobs} cron jobs`);
  } catch (error) {
    console.error('❌ Error stopping cron jobs:', error);
  }
  
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM. Shutting down...');
  
  try {
    const { stopCronJobs } = require('./utils/cronJobs');
    stopCronJobs();
    console.log('✅ Cron jobs stopped');
  } catch (error) {
    console.error('❌ Error stopping cron jobs:', error);
  }
  
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  
  // Try to stop cron jobs before exiting
  try {
    const { stopCronJobs } = require('./utils/cronJobs');
    stopCronJobs();
  } catch (cronError) {
    console.error('Error stopping cron jobs during exception:', cronError);
  }
  
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  
  // Don't exit the process for unhandled rejections in production
  if (process.env.NODE_ENV === 'development') {
    process.exit(1);
  }
});

module.exports = app;