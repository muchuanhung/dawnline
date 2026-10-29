#!/usr/bin/env bash
# Swap the velorder-api container to a new ECR image, with health check and rollback.
# Runs on the EC2 host as root, sent by backend-deploy.yml through ssm-run.sh.
#
#   IMAGE=<account>.dkr.ecr.ap-northeast-1.amazonaws.com/dawnline-api:<sha> bash deploy.sh
#
# Container settings must match backend/docs/deploy-aws.md section 3.
set -euo pipefail

: "${IMAGE:?IMAGE is not set}"
REGION=${REGION:-ap-northeast-1}
CONTAINER=velorder-api
ENV_FILE=/opt/velorder/api.env
HEALTH_URL=http://127.0.0.1:8001/health
# Keep this many dawnline-api images on disk (current + rollback targets).
KEEP_IMAGES=3

registry=${IMAGE%%/*}
repository=${IMAGE%:*}

log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }

start_container() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$CONTAINER" --restart unless-stopped \
    --network dawnline \
    -p 127.0.0.1:8001:8000 \
    --env-file "$ENV_FILE" \
    "$1" >/dev/null
}

# Wait for the Dockerfile HEALTHCHECK to report healthy, then confirm through the host port.
# The container runs `alembic upgrade head` first, so a failed migration shows up as an exit.
wait_healthy() {
  local state
  for _ in $(seq 1 60); do
    state=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$CONTAINER" 2>/dev/null || echo "missing")
    case $state in
      "running healthy") curl -fsS "$HEALTH_URL" && echo && return 0 ;;
      exited* | dead* | missing) break ;;
    esac
    sleep 3
  done
  log "container state: $state"
  docker logs --tail 50 "$CONTAINER" 2>&1 || true
  return 1
}

# The host has no aws CLI; use the official image like the backup cron does.
# It reaches the instance role through IMDS (hop limit 2).
log "login $registry"
docker run --rm amazon/aws-cli ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$registry" >/dev/null

log "pull $IMAGE"
docker pull -q "$IMAGE"

previous=$(docker inspect -f '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || true)
log "previous image: ${previous:-none}"

log "start $IMAGE"
start_container "$IMAGE"
if ! wait_healthy; then
  if [[ -n $previous && $previous != "$IMAGE" ]]; then
    # Note: migrations already applied by the new image stay applied; old code must
    # tolerate the newer schema (additive migrations only, see deploy-aws.md).
    log "new image unhealthy, rolling back to $previous"
    start_container "$previous"
    wait_healthy || log "ROLLBACK ALSO UNHEALTHY, manual action needed"
  fi
  exit 1
fi

# Free disk on the small root volume: drop older dawnline-api images and dangling layers.
# `docker images` lists newest first; images still used by a container are refused by rmi.
docker images "$repository" --format '{{.ID}}' | awk '!seen[$0]++' | tail -n +$((KEEP_IMAGES + 1)) \
  | xargs -r docker rmi >/dev/null 2>&1 || true
docker image prune -f >/dev/null

log "deployed $IMAGE"
