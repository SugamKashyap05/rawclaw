#!/usr/bin/env bash
set -e

# Backup script for RawClaw (SQLite, artifacts, env template)
# Runs from the project root

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="../rawclaw_backups/backup_$TIMESTAMP"

echo "Creating backup at $BACKUP_DIR..."
mkdir -p "$BACKUP_DIR"

# Backup SQLite state if it exists
if [ -f "data/state.sqlite" ]; then
    cp data/state.sqlite "$BACKUP_DIR/"
fi

# Backup artifacts
if [ -d "artifacts" ]; then
    cp -r artifacts "$BACKUP_DIR/"
fi

# Backup env template
if [ -f ".env.example" ]; then
    cp .env.example "$BACKUP_DIR/"
fi

# Zip the backup
cd ../rawclaw_backups
zip -r "backup_$TIMESTAMP.zip" "backup_$TIMESTAMP"
rm -rf "backup_$TIMESTAMP"

echo "Backup complete: backup_$TIMESTAMP.zip"
