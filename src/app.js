require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors({
  origin: 'https://cryptominepro.vercel.app',
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

// Basic route for testing
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to CryptoMinePro API' });
});

app.use('/api/users', userRoutes);
app.use('/api/mining-engines', miningEngineRoutes);
app.use('/api/deposits', depositRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/earnings', earningRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/mpesa', mpesaRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
