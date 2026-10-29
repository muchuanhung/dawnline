#!/usr/bin/env bash
# Run a local shell script on the EC2 host through SSM Run Command and wait for it.
# Used by GitHub Actions (backend-deploy.yml, backend-monitor.yml); the runner already
# holds AWS credentials from the OIDC role.
#
#   ssm-run.sh <script> [KEY=VALUE ...]
#
# The script is shipped base64-encoded so it runs byte-for-byte under bash on the host
# (AWS-RunShellScript would otherwise run each line under /bin/sh). KEY=VALUE pairs are
# exported before it runs. Exit code and output of the remote script are passed through.
set -euo pipefail

script=${1:?usage: ssm-run.sh <script> [KEY=VALUE ...]}
shift
: "${EC2_INSTANCE_ID:?EC2_INSTANCE_ID is not set}"
region=${AWS_REGION:-ap-northeast-1}
timeout=${SSM_TIMEOUT_SECONDS:-600}

payload=$(base64 -w0 "$script")
exports=""
for kv in "$@"; do
  # printf %q keeps values with spaces or quotes intact on the remote side
  exports+="export $(printf '%q' "$kv"); "
done

params=$(jq -nc --arg cmd "${exports}echo $payload | base64 -d > /tmp/dawnline-ssm.sh && bash /tmp/dawnline-ssm.sh" \
  --arg t "$timeout" '{commands: [$cmd], executionTimeout: [$t]}')

command_id=$(aws ssm send-command \
  --region "$region" \
  --instance-ids "$EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "dawnline $(basename "$script")" \
  --parameters "$params" \
  --query Command.CommandId --output text)
echo "SSM command $command_id on $EC2_INSTANCE_ID"

# Poll instead of `aws ssm wait command-executed`: that waiter gives up after 100 s,
# shorter than a cold image pull on the 1 GB instance.
deadline=$((SECONDS + timeout + 60))
status=Pending
while (( SECONDS < deadline )); do
  sleep 5
  status=$(aws ssm get-command-invocation --region "$region" \
    --command-id "$command_id" --instance-id "$EC2_INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)
  case $status in
    Pending | InProgress | Delayed) continue ;;
    *) break ;;
  esac
done

aws ssm get-command-invocation --region "$region" \
  --command-id "$command_id" --instance-id "$EC2_INSTANCE_ID" \
  --query '[StandardOutputContent, StandardErrorContent]' --output text || true

echo "SSM status: $status"
[[ $status == Success ]]
