#!/bin/bash
# Clean up RuVector PostgreSQL data

set -e

HOST="${PGHOST:-localhost}"
PORT="${PGPORT:-5432}"
DATABASE="${PGDATABASE:-hakanmcp}"
USER="${PGUSER:-claude}"
PASSWORD="${PGPASSWORD:-hakanmcp-test}"

echo "🧹 Cleaning up RuVector PostgreSQL"
echo "=========================================="
echo ""
echo "⚠️  WARNING: This will delete ALL data in the hakanmcp schema!"
echo ""
read -p "Are you sure? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "Dropping schema..."
PGPASSWORD=$PASSWORD psql -h $HOST -p $PORT -U $USER -d $DATABASE -c \
    "DROP SCHEMA IF EXISTS hakanmcp CASCADE;"

echo "Recreating schema..."
PGPASSWORD=$PASSWORD psql -h $HOST -p $PORT -U $USER -d $DATABASE -c \
    "CREATE SCHEMA hakanmcp; GRANT ALL ON SCHEMA hakanmcp TO $USER;"

echo ""
echo "✅ Cleanup complete!"
echo ""
echo "To reinitialize, run:"
echo "  docker-compose down -v && docker-compose up -d"
echo ""
echo "Or run the init script manually:"
echo "  ./scripts/run-migrations.sh"
