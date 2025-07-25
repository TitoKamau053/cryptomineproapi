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

const { verifyToken } = require('./middleware/authMiddleware');
const { verifyAdminRole } = require('./middleware/adminMiddleware');

// Basic route for testing
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to CryptoMinePro API' });
});

// Public routes
app.use('/api/users', userRoutes);
app.use('/api/mining-engines', miningEngineRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/earnings', earningRoutes);
app.use('/api/mpesa', mpesaRoutes);

// Protected routes
app.use('/api/deposits', verifyToken, depositRoutes);
app.use('/api/withdrawals', verifyToken, withdrawalRoutes);
app.use('/api/referrals', verifyToken, referralRoutes);

// Admin routes with admin role verification
app.use('/api/admin', verifyToken, verifyAdminRole, adminRoutes);

const PORT = process.env.PORT || 3000;

// Only start server if not in test environment
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

module.exports = app;
