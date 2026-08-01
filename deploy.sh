#!/bin/bash
# Deploy idempotente do task-refiner. Executado via GitHub Actions (deploy.yml) ou manualmente.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

LOG_DIR="$REPO_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/deploy.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"; }

log "=== Deploy iniciado (commit atual: $(git rev-parse --short HEAD)) ==="

git fetch origin main
git reset --hard origin/main
log "Código atualizado para $(git rev-parse --short HEAD)"

npm ci
log "Dependências instaladas (npm ci)"

pm2 restart task-refiner --update-env
log "Processo pm2 'task-refiner' reiniciado"

sleep 3
CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3099/)"
if [ "$CODE" -ge 200 ] && [ "$CODE" -lt 500 ]; then
  log "Health-check OK (HTTP $CODE)"
else
  log "ERRO: health-check falhou (HTTP $CODE)"
  exit 1
fi

log "=== Deploy concluído com sucesso ==="
