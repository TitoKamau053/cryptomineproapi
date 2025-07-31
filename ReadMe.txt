# Enhanced Mining System with Hourly/Daily Processing

This enhanced mining system provides comprehensive support for both hourly and daily mining engines with extensive debugging and monitoring capabilities.

## 🚀 Key Features

### Mining Engine Types
- **Hourly Mining**: Processes earnings every hour with precise timing
- **Daily Mining**: Processes earnings once per day at midnight
- **Flexible Configuration**: Admins can create either type with full validation
- **Real-time Processing**: Automatic cron jobs handle earnings distribution

### Debugging & Monitoring
- **System Health Checks**: Monitor earnings processing status
- **Purchase Debugging**: Detailed analysis of individual purchase earnings
- **Queue Status**: Check pending earnings processing
- **Performance Analytics**: Comprehensive engine performance metrics

## 📋 API Endpoints

### Mining Engine Management

#### Public Endpoints
```
GET /api/mining-engines
- Get all active mining engines
- Query params: include_inactive, earning_interval, sort_by, include_stats

GET /api/mining-engines/:engineId
- Get detailed engine information
- Query params: include_stats (true/false)
```

#### Admin Endpoints
```
POST /api/mining-engines
- Create new mining engine
- Body: { name, price, daily_earning_rate, duration_days, earning_interval, ... }

PUT /api/mining-engines/:engineId
- Update existing engine
- Body: { field_to_update: new_value }

DELETE /api/mining-engines/:engineId
- Delete engine (with safety checks)
- Query params: force, confirm

POST /api/mining-engines/test/config
- Test engine configuration before creation
- Body: { price, daily_earning_rate, duration_days, earning_interval }
```

### Earnings Management

#### User Endpoints
```
GET /api/earnings
- Get user's earnings history
- Query params: page, limit, start_date, end_date, engine_id

GET /api/earnings/summary
- Get user's earnings summary for dashboard
```

#### Admin Endpoints
```
GET /api/earnings/admin/earnings
- Get all earnings with advanced filtering
- Query params: user_id, purchase_id, engine_id, earning_interval

GET /api/earnings/admin/stats
- Get earnings statistics
- Query params: period (24h, 7d, 30d)

POST /api/earnings/log
- Manually log an earning
- Body: { purchase_id, earning_amount, earning_datetime }

POST /api/earnings/trigger/:purchase_id
- Trigger manual earnings processing for specific purchase
```

### Debugging Endpoints

```
GET /api/earnings/debug/purchase/:purchase_id
- Get detailed purchase earning analysis
- Shows expected vs actual earnings, processing status

GET /api/earnings/debug/health
- System health check for earnings processing
- Shows processing status, overdue purchases, system metrics

POST /api/earnings/debug/test-processing
- Test earnings processing
- Body: { interval_type, purchase_id }

GET /api/earnings/debug/queue-status
- Get processing queue status
- Shows pending hourly/daily earnings

POST /api/earnings/debug/simulate
- Simulate earnings without creating records
- Body: { purchase_id, periods, interval_type }
```

### Enhanced Mining Engine Endpoints

```
POST /api/mining-engines/:engineId/simulate
- Simulate earnings for specific engine
- Body: { investment_amount, simulation_periods, start_from }

GET /api/mining-engines/:engineId/analytics
- Get engine performance analytics
- Query params: period (7d, 30d, 90d, all)

POST /api/mining-engines/batch/operations
- Batch operations on multiple engines
- Body: { operation, engine_ids, parameters }

POST /api/mining-engines/compare
- Compare multiple engines
- Body: { engine_ids, investment_amount, comparison_period }

GET /api/mining-engines/:engineId/health
- Check engine configuration health
```

## 🛠️ Configuration Examples

### Creating Hourly Mining Engine
```json
{
  "name": "Bitcoin Miner Pro",
  "description": "High-frequency Bitcoin mining with hourly returns",
  "price": 1000,
  "daily_earning_rate": 0.1,
  "duration_days": 365,
  "min_investment": 100,
  "max_investment": 10000,
  "earning_interval": "hourly",
  "is_active": true
}
```

**Calculation**: 
- Hourly Rate: 0.1% per hour
- Daily Rate: 0.1% × 24 = 2.4% per day
- Annual Rate: 2.4% × 365 = 876% per year

### Creating Daily Mining Engine
```json
{
  "name": "Ethereum Validator",
  "description": "Stable daily Ethereum staking rewards",
  "price": 5000,
  "daily_earning_rate": 0.15,
  "duration_days": 730,
  "min_investment": 1000,
  "max_investment": 50000,
  "earning_interval": "daily",
  "is_active": true
}
```

**Calculation**:
- Daily Rate: 0.15% per day
- Annual Rate: 0.15% × 365 = 54.75% per year

## 🔧 Environment Variables

```bash
# Debug modes
DEBUG_EARNINGS=true          # Enable detailed earnings processing logs
DEBUG_CRON=true             # Enable detailed cron job logs

# Database connection
DB_HOST=localhost
DB_PORT=3306
DB_NAME=cryptominepro
DB_USER=root
DB_PASSWORD=your_password

# Timezone for cron jobs
TZ=Africa/Nairobi
```

## 📊 Cron Job Schedule

### Automatic Processing
- **Hourly Earnings**: Every hour at :00 minutes (`0 * * * *`)
- **Daily Earnings**: Every day at midnight (`0 0 * * *`)
- **System Maintenance**: Every day at 2:00 AM (`0 2 * * *`)
- **Health Checks**: Every 6 hours (`0 */6 * * *`)

### Manual Processing
```javascript
// Trigger manual processing
const { triggerManualProcessing } = require('./utils/cronJobManager');

// Process all pending earnings
await triggerManualProcessing();

// Process only hourly earnings
await triggerManualProcessing({ intervalType: 'hourly' });

// Process only daily earnings
await triggerManualProcessing({ intervalType: 'daily' });

// Dry run (see what would be processed)
await triggerManualProcessing({ dryRun: true });
```

## 🔍 Debugging Workflow

### 1. Check System Health
```bash
GET /api/earnings/debug/health
```
This shows overall system status, recent processing activity, and any issues.

### 2. Check Processing Queue
```bash
GET /api/earnings/debug/queue-status
```
Shows how many purchases are pending processing for hourly/daily intervals.

### 3. Debug Specific Purchase
```bash
GET /api/earnings/debug/purchase/123
```
Detailed analysis of purchase #123 including expected vs actual earnings.

### 4. Test Processing
```bash
POST /api/earnings/debug/test-processing
{
  "interval_type": "hourly",
  "purchase_id": 123
}
```

### 5. Simulate Earnings
```bash
POST /api/earnings/debug/simulate
{
  "purchase_id": 123,
  "periods": 24,
  "interval_type": "hourly"
}
```

## 📈 Monitoring Dashboard Data

### Key Metrics to Monitor
1. **Processing Health**: Are cron jobs running successfully?
2. **Queue Status**: How many purchases are pending processing?
3. **Error Rates**: Any failures in earnings processing?
4. **Performance**: How long does processing take?

### Sample Dashboard Query
```sql
-- Get processing summary for last 24 hours
SELECT 
    me.earning_interval,
    COUNT(el.id) as earnings_processed,
    COUNT(DISTINCT el.purchase_id) as active_purchases,
    SUM(el.earning_amount) as total_amount,
    MIN(el.created_at) as first_processed,
    MAX(el.created_at) as last_processed
FROM engine_logs el
JOIN purchases p ON el.purchase_id = p.id
JOIN mining_engines me ON p.engine_id = me.id
WHERE el.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
GROUP BY me.earning_interval;
```

## 🚨 Troubleshooting

### Common Issues

#### 1. Earnings Not Processing
**Check**: 
- Cron jobs running? `GET /api/earnings/debug/health`
- Purchase status active? `GET /api/earnings/debug/purchase/:id`
- Engine active? `GET /api/mining-engines/:id`

**Fix**: 
- Restart cron jobs
- Manual trigger: `POST /api/earnings/debug/test-processing`

#### 2. Duplicate Earnings
**Cause**: Multiple processing attempts or cron overlap
**Prevention**: Built-in duplicate detection in `sp_log_earning` procedure

#### 3. High CPU Usage
**Cause**: Too many concurrent earnings processing
**Fix**: Optimize batch sizes in `processMiningEarnings`

#### 4. Unrealistic Returns
**Check**: Use `POST /api/mining-engines/test/config` before creating engines
**Fix**: Validate earning rates and duration settings

### Performance Optimization

#### 1. Database Indexes
Ensure proper indexes exist:
```sql
-- Key indexes for performance
CREATE INDEX idx_engine_logs_datetime ON engine_logs(earning_datetime);
CREATE INDEX idx_engine_logs_purchase_datetime ON engine_logs(purchase_id, earning_datetime);
CREATE INDEX idx_purchases_status_engine ON purchases(status, engine_id);
```

#### 2. Batch Processing
For large systems, consider processing in smaller batches:
```javascript
// Process in batches of 100 purchases
const BATCH_SIZE = 100;
```

#### 3. Connection Pooling
Ensure adequate database connection pool size for concurrent processing.

## 📝 Development Setup

### 1. Install Dependencies
```bash
npm install node-cron mysql2
```

### 2. Database Setup
```sql
-- Create required stored procedures (already in your dump)
-- Ensure proper permissions for cron user
```

### 3. Start Cron Jobs
```javascript
const { startCronJobs } = require('./utils/cronJobManager');
startCronJobs();
```

### 4. Test Configuration
```bash
# Test engine configuration
POST /api/mining-engines/test/config

# Test earnings processing
POST /api/earnings/debug/test-processing

# Check system health
GET /api/earnings/debug/health
```

## 🔒 Security Considerations

1. **Admin-only Access**: All debugging endpoints require admin authentication
2. **Rate Limiting**: Consider implementing rate limits on debug endpoints
3. **Input Validation**: All inputs are validated before processing
4. **SQL Injection**: Using parameterized queries throughout
5. **Error Handling**: Sensitive information not exposed in error messages

## 📋 Maintenance Tasks

### Daily
- Monitor cron job execution logs
- Check system health endpoint
- Review any admin alerts

### Weekly
- Analyze engine performance metrics
- Review earnings processing statistics
- Check for any anomalies in ROI calculations

### Monthly
- Database maintenance (indexes, optimization)
- Review and update earning rate configurations
- Analyze user engagement metrics

This enhanced system provides enterprise-level mining engine management with comprehensive debugging capabilities. The modular design allows for easy expansion and maintenance while ensuring reliable earnings processing for both hourly and daily intervals.