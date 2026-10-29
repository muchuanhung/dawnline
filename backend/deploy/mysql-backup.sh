#!/usr/bin/env bash
# Daily MySQL dump to S3. Installed on the EC2 host as /etc/cron.daily/dawnline-mysql-backup
# (no ".sh": run-parts skips file names with dots). See backend/docs/deploy-aws.md section 6.
#
# backend-monitor.yml alerts when the newest object under backups/ is older than 26 h,
# so a failure here (or cron not running at all) is noticed within a day.
set -euo pipefail

BUCKET=${BACKUP_BUCKET:-dawnline-gpx}
REGION=${BACKUP_REGION:-ap-northeast-1}
key="backups/velorder-$(date -u +%F).sql.gz"

tmp=$(mktemp /tmp/velorder-backup.XXXXXX)
trap 'rm -f "$tmp"' EXIT

# pipefail makes a failed mysqldump fail the script instead of uploading a truncated file.
docker exec dawnline-mysql sh -c \
  'mysqldump -u velorder -p"$MYSQL_PASSWORD" --single-transaction --no-tablespaces velorder' \
  | gzip >"$tmp"

# Sanity checks before upload: valid gzip and mysqldump's completion trailer.
gzip -t "$tmp"
zcat "$tmp" | tail -n 1 | grep -q '^-- Dump completed'

docker run --rm -i amazon/aws-cli s3 cp - "s3://$BUCKET/$key" --region "$REGION" <"$tmp"
logger -t dawnline-backup "uploaded s3://$BUCKET/$key ($(stat -c %s "$tmp") bytes)"
