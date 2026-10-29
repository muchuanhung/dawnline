#!/usr/bin/env bash
# Host health snapshot for backend-monitor.yml (sent through ssm-run.sh, runs as root).
# Prints one line per check and exits 1 if any check fails.
set -uo pipefail

DISK_MAX_PERCENT=${DISK_MAX_PERCENT:-85}
MEM_MIN_MB=${MEM_MIN_MB:-100}
failed=0

check() {
  if [[ $1 == ok ]]; then echo "ok    $2"; else echo "FAIL  $2"; failed=1; fi
}

disk=$(df --output=pcent / | tail -1 | tr -dc '0-9')
check "$([[ $disk -lt $DISK_MAX_PERCENT ]] && echo ok)" "disk / ${disk}% (limit ${DISK_MAX_PERCENT}%)"

# MemAvailable plus free swap: the instance has 1 GB RAM and 1 GB swap.
read -r mem_kb swap_kb < <(awk '/^MemAvailable:/{m=$2} /^SwapFree:/{s=$2} END{print m, s}' /proc/meminfo)
avail_mb=$(((mem_kb + swap_kb) / 1024))
check "$([[ $avail_mb -ge $MEM_MIN_MB ]] && echo ok)" "memory+swap available ${avail_mb} MB (min ${MEM_MIN_MB} MB)"

api=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' velorder-api 2>/dev/null || echo missing)
check "$([[ $api == "running healthy" ]] && echo ok)" "velorder-api: $api"

db=$(docker inspect -f '{{.State.Status}} restarts={{.RestartCount}}' dawnline-mysql 2>/dev/null || echo missing)
check "$([[ $db == running* ]] && echo ok)" "dawnline-mysql: $db"

nginx=$(systemctl is-active nginx 2>/dev/null || true)
check "$([[ $nginx == active ]] && echo ok)" "nginx: $nginx"

exit $failed
