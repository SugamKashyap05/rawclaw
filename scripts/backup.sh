#!/bin/bash

# Configuration
PROJECT_ROOT=$(pwd)
DB_PATH="apps/api/prisma/dev.db"
ARTIFACTS_DIR="artifacts"
ENV_FILE=".env.example"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PARENT_DIR="../rawclaw_backups"
STAGING_DIR="$BACKUP_PARENT_DIR/rawclaw_backup_$TIMESTAMP"
ZIP_FILE="$BACKUP_PARENT_DIR/rawclaw_backup_$TIMESTAMP.zip"

echo "=== RawClaw Backup System ==="
echo "Timestamp: $TIMESTAMP"

# 1. Create staging directory
mkdir -p "$STAGING_DIR" || { echo "Error: Could not create backup directory"; exit 1; }

# 2. Backup Database
if [ -f "$DB_PATH" ]; then
    DB_SIZE=$(stat -c%s "$DB_PATH" 2>/dev/null || stat -f%z "$DB_PATH" 2>/dev/null)
    if [ "$DB_SIZE" -gt 0 ]; then
        cp "$DB_PATH" "$STAGING_DIR/dev.db"
        echo "✓ Database backed up successfully"
    else
        echo "! Warning: Database file exists but is 0 bytes. Skipping copy."
    fi
else
    echo "! Warning: Database file not found at $DB_PATH. Skipping copy."
fi

# 3. Backup Artifacts
if [ -d "$ARTIFACTS_DIR" ]; then
    cp -r "$ARTIFACTS_DIR" "$STAGING_DIR/"
    echo "✓ Artifacts backed up successfully"
else
    echo "! Info: Artifacts directory not found. Skipping."
fi

# 4. Backup Config Template
if [ -f "$ENV_FILE" ]; then
    cp "$ENV_FILE" "$STAGING_DIR/"
    echo "✓ Environment template backed up"
else
    echo "! Warning: $ENV_FILE not found."
fi

# 5. Create ZIP and cleanup
echo "Compressing backup..."
if command -v zip >/dev/null 2>&1; then
    (cd "$BACKUP_PARENT_DIR" && zip -r "rawclaw_backup_$TIMESTAMP.zip" "rawclaw_backup_$TIMESTAMP" > /dev/null)
    ZIP_EXIT_CODE=$?
else
    # Fallback to PowerShell for Windows environments
    powershell.exe -Command "Compress-Archive -Path '$STAGING_DIR' -DestinationPath '$ZIP_FILE' -Force"
    ZIP_EXIT_CODE=$?
fi

if [ $ZIP_EXIT_CODE -eq 0 ]; then
    rm -rf "$STAGING_DIR"
    echo "=== Backup Complete ==="
    echo "Location: $ZIP_FILE"
    exit 0
else
    echo "Error: Compression failed"
    exit 1
fi
