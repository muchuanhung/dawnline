#!/usr/bin/env bash
# Daily MySQL dump to S3. Installed on the EC2 host as /etc/cron.daily/dawnline-mysql-backup
# (no ".sh": run-parts skips file names with dots). See backend/docs/deploy-aws.md section 6.
#
# The dump goes to the Tokyo bucket and to a second bucket in Osaka, and users/ (uploaded GPX,
# avatars) is copied to Osaka, so the data survives the loss of the whole Tokyo region.
# backend-monitor.yml alerts when the newest object under backups/ in either bucket is older than
# 26 h, so a failure here (or cron not running at all) is noticed within a day.
set -euo pipefail

BUCKET=${BACKUP_BUCKET:-dawnline-gpx}
REGION=${BACKUP_REGION:-ap-northeast-1}
DR_BUCKET=${BACKUP_DR_BUCKET:-dawnline-gpx-osaka}
DR_REGION=${BACKUP_DR_REGION:-ap-northeast-3}
key="backups/velorder-$(date -u +%F).sql.gz"

tmp=$(mktemp /tmp/velorder-backup.XXXXXX)
trap 'rm -f "$tmp"' EXIT

# pipefail makes a failed mysqldump fail the script instead of uploading a truncated file.
# The password never goes on a command line (no warning, not visible in ps): the in-container
# shell writes it with the printf builtin into a 0600 temp option file, passed via
# --defaults-extra-file and removed on exit. Passwords containing " or a newline are rejected
# because they can't be written safely into an option file.
docker exec dawnline-mysql sh -c '
  set -eu
  case "$MYSQL_PASSWORD" in
    *\"* | *"
"*) echo "MYSQL_PASSWORD contains a double quote or newline; refusing to write option file" >&2; exit 1 ;;
  esac
  umask 077
  cnf=$(mktemp)
  trap "rm -f \"\$cnf\"" EXIT
  esc=$(printf "%s" "$MYSQL_PASSWORD" | sed "s/\\\\/\\\\\\\\/g")
  printf "[client]\nuser=velorder\npassword=\"%s\"\n" "$esc" >"$cnf"
  mysqldump --defaults-extra-file="$cnf" --single-transaction --no-tablespaces velorder
' | gzip >"$tmp"

# Sanity checks before upload: valid gzip and mysqldump's completion trailer.
gzip -t "$tmp"
zcat "$tmp" | tail -n 1 | grep -q '^-- Dump completed'

size=$(stat -c %s "$tmp")
docker run --rm -i amazon/aws-cli s3 cp - "s3://$BUCKET/$key" --region "$REGION" <"$tmp"
logger -t dawnline-backup "uploaded s3://$BUCKET/$key ($size bytes)"

docker run --rm -i amazon/aws-cli s3 cp - "s3://$DR_BUCKET/$key" --region "$DR_REGION" <"$tmp"
logger -t dawnline-backup "uploaded s3://$DR_BUCKET/$key ($size bytes)"

# Server-side copy of new or changed user files. No --delete: the EC2 role has no DeleteObject on
# the Osaka bucket, so a file deleted in Tokyo stays in Osaka (see deploy-aws.md section 6).
docker run --rm amazon/aws-cli s3 sync "s3://$BUCKET/users/" "s3://$DR_BUCKET/users/" \
  --source-region "$REGION" --region "$DR_REGION" --only-show-errors
logger -t dawnline-backup "synced s3://$BUCKET/users/ to s3://$DR_BUCKET/users/"
