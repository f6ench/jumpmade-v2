#!/usr/bin/env bash
# Build the production CSS, then rsync index.html + dist + assets to the
# Hetzner VPS. Caddy serves changed files immediately — no reload needed.
#
# Required env: DEPLOY_USER, DEPLOY_HOST.
# Example:
#   DEPLOY_USER=root DEPLOY_HOST=1.2.3.4 ./deploy.sh
#
# Caddyfile changes (server config) require a manual reload — see README.

set -euo pipefail

: "${DEPLOY_USER:?Set DEPLOY_USER (e.g. root)}"
: "${DEPLOY_HOST:?Set DEPLOY_HOST (e.g. the Hetzner VPS IP)}"

cd "$(dirname "$0")"

echo "==> Building production CSS"
npx tailwindcss -i styles/input.css -o dist/output.css --minify

echo "==> Verifying artifacts"
test -f index.html
test -f dist/output.css
test -d assets

echo "==> Deploying to $DEPLOY_USER@$DEPLOY_HOST:/srv/jumpmade.com/"
rsync -avz --delete \
    index.html \
    dist \
    assets \
    "$DEPLOY_USER@$DEPLOY_HOST:/srv/jumpmade.com/"

echo "==> Done. https://jumpmade.com should reflect the new build."
