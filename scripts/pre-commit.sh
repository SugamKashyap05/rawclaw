#!/usr/bin/env bash
set -e

echo "Running RawClaw pre-commit hook..."

# 1. Block commits with .env files containing real secrets
if git diff --cached --name-only | grep -E '\.env$'; then
    echo "ERROR: Trying to commit a .env file. Real secrets are not allowed."
    exit 1
fi

# 2. Run check-types on staged TS files
echo "Checking types..."
npm run check-types

echo "Pre-commit checks passed."
