# Deploy

Push para `main` dispara `.github/workflows/deploy.yml`, que conecta via SSH na VPS e roda `deploy.sh`.

Este projeto tem um `docker-compose.yml`, mas hoje **não** roda em container — Docker não está
instalado nesta VPS. Ele roda direto via PM2 (processo `task-refiner`), e este pipeline segue o
mesmo modelo. Não há build (JS puro) nem migrations.

## O que o deploy.sh faz
1. `git fetch` + `git reset --hard origin/main`
2. `npm ci`
3. `pm2 restart task-refiner --update-env`
4. Health-check em `http://127.0.0.1:3099/`
5. Log em `logs/deploy.log`

## Rollback manual
```bash
cd /home/ubuntu/task-refiner
git log --oneline
git reset --hard <commit-anterior>
bash deploy.sh
```

## Logs
- Deploy: `/home/ubuntu/task-refiner/logs/deploy.log`
- Runtime: `pm2 logs task-refiner`

## Secrets necessários no GitHub
- `VPS_HOST`
- `VPS_DEPLOY_USER`
- `VPS_DEPLOY_KEY`
