#!/bin/bash

echo "=== Finding All References to 'completed' Column ==="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🔍 Searching for 'completed' references in your codebase...${NC}"
echo ""

# Find all JavaScript files that might contain the problematic query
echo -e "${GREEN}📁 Searching JavaScript files:${NC}"
find . -name "*.js" -type f -exec grep -l "completed" {} \; 2>/dev/null | while read file; do
    echo "  📄 $file"
    grep -n "completed" "$file" 2>/dev/null | head -3
    echo ""
done

# Find SQL files
echo -e "${GREEN}📁 Searching SQL files:${NC}"
find . -name "*.sql" -type f -exec grep -l "completed" {} \; 2>/dev/null | while read file; do
    echo "  📄 $file"
    grep -n "completed" "$file" 2>/dev/null | head -3
    echo ""
done

# Check common config files and logs
echo -e "${GREEN}📁 Checking configuration files:${NC}"
for ext in json yml yaml env; do
    find . -name "*.$ext" -type f -exec grep -l "completed" {} \; 2>/dev/null | while read file; do
        echo "  📄 $file"
        grep -n "completed" "$file" 2>/dev/null
        echo ""
    done
done

# Check for cron jobs
echo -e "${GREEN}⏰ Checking cron jobs:${NC}"
if command -v crontab &> /dev/null; then
    crontab -l 2>/dev/null | grep -n "." | while read line; do
        echo "  $line"
    done
else
    echo "  No crontab command available"
fi
echo ""

# Check for running processes
echo -e "${GREEN}🔄 Checking running Node.js processes:${NC}"
if command -v ps &> /dev/null; then
    ps aux | grep node | grep -v grep | while read line; do
        echo "  $line"
    done
else
    echo "  No ps command available"
fi
echo ""

# Check package.json scripts
echo -e "${GREEN}📦 Checking package.json scripts:${NC}"
if [ -f "package.json" ]; then
    grep -A 20 '"scripts"' package.json | grep -E "(cron|schedule|earn|process|mine)" || echo "  No relevant scripts found"
else
    echo "  No package.json found"
fi
echo ""

# Look for PM2 processes if available
echo -e "${GREEN}🔧 Checking PM2 processes:${NC}"
if command -v pm2 &> /dev/null; then
    pm2 list 2>/dev/null || echo "  No PM2 processes running"
else
    echo "  PM2 not installed"
fi
echo ""

# Check systemd services
echo -e "${GREEN}🏃 Checking systemd services:${NC}"
if command -v systemctl &> /dev/null; then
    systemctl list-units --type=service --state=running | grep -i "node\|earn\|mine\|cron" || echo "  No relevant services found"
else
    echo "  systemctl not available"
fi
echo ""

echo -e "${YELLOW}🎯 Most likely culprits to check:${NC}"
echo "1. A cron job script that processes earnings"
echo "2. A background Node.js process/daemon"
echo "3. A database migration or seed file"
echo "4. Another earnings processing script"
echo ""

echo -e "${RED}⚠️  If you find any files referencing 'completed', check them for SQL queries!${NC}"