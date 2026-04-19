#!/usr/bin/env bash
# Daily gzip backup of mulmoclaude workspace data directories.
# Keeps the last 30 days of backups.

set -euo pipefail

WORKSPACE="/home/exedev/mulmoclaude"
BACKUP_DIR="/home/exedev/backups/mulmoclaude"
DATE=$(date +%Y%m%d)
ARCHIVE="${BACKUP_DIR}/workspace-${DATE}.tar.gz"
KEEP_DAYS=30

mkdir -p "${BACKUP_DIR}"

tar -czf "${ARCHIVE}" \
  -C "${WORKSPACE}" \
  --ignore-failed-read \
  config \
  conversations \
  data \
  artifacts \
  2>/dev/null || true

echo "Backup created: ${ARCHIVE} ($(du -sh "${ARCHIVE}" | cut -f1))"

# Remove backups older than KEEP_DAYS days
find "${BACKUP_DIR}" -name "workspace-*.tar.gz" -mtime "+${KEEP_DAYS}" -delete
echo "Cleaned up backups older than ${KEEP_DAYS} days"
