#!/usr/bin/env bash
# Manual deploy on the VPS (same steps as GitHub Actions).
set -euo pipefail

cd "$(dirname "$0")/.."

git fetch origin
git checkout main
git reset --hard origin/main
npm ci
npm run build
mkdir -p data
pm2 restart thulla --update-env || pm2 start npm --name thulla -- run server
pm2 save
pm2 status thulla

echo "Deployed $(git rev-parse --short HEAD)"
