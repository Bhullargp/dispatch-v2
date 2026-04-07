#!/bin/bash
# Migration script: better-sqlite3 -> PostgreSQL for Dispatch Master
set -e

cd /Users/gurneet/.openclaw/workspace/dispatch-main

# Helper function to check PG tables exist
echo "=== Checking PostgreSQL tables ==="
PGPASSWORD='karandeep@' psql -h 127.0.0.1 -U dispatch_user -d masterdb -c "SELECT table_name FROM information_schema.tables WHERE table_schema='dispatch'" 2>&1

echo ""
echo "=== Starting file migrations ==="
