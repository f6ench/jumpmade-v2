#!/usr/bin/env bash
# Build the production CSS, then rsync index.html + dist + assets to the
# Hetzner VPS at /var/www/jumpmade.com/. nginx serves files immediately —
# no reload needed unless nginx-jumpmade.conf itself changed.
#
# Required env: DEPLOY_USER, DEPLOY_HOST, DEPLOY_KEY.
# Example:
#   DEPLOY_USER=root DEPLOY_HOST=178.104.143.6 DEPLOY_KEY=~/.ssh/resinly-vps-key ./deploy.sh
#
# nginx config changes (nginx-jumpmade.conf) require a manual upload + reload:
#   scp nginx-jumpmade.conf $DEPLOY_USER@$DEPLOY_HOST:/etc/nginx/sites-available/jumpmade.com
#   ssh $DEPLOY_USER@$DEPLOY_HOST "sudo nginx -t && sudo systemctl reload nginx"

set -euo pipefail

: "${DEPLOY_USER:?Set DEPLOY_USER (e.g. root)}"
: "${DEPLOY_HOST:?Set DEPLOY_HOST (e.g. 178.104.143.6)}"
: "${DEPLOY_KEY:=$HOME/.ssh/resinly-vps-key}"

cd "$(dirname "$0")"

echo "==> Building production CSS"
npx tailwindcss -i styles/input.css -o dist/output.css --minify

echo "==> Verifying artifacts"
test -f index.html
test -f dist/output.css
test -d assets

echo "==> Deploying to $DEPLOY_USER@$DEPLOY_HOST:/var/www/jumpmade.com/"
SSH_OPTS="-i $DEPLOY_KEY -o IdentitiesOnly=yes -o BatchMode=yes"
# Pack locally, unpack remotely. Avoids rsync dependency on Windows.
tar czf - index.html dist assets | \
    ssh $SSH_OPTS "$DEPLOY_USER@$DEPLOY_HOST" \
    "rm -rf /var/www/jumpmade.com/* && tar xzf - -C /var/www/jumpmade.com/ && chown -R www-data:www-data /var/www/jumpmade.com"

echo "==> Done. Check https://jumpmade.com (or http://$DEPLOY_HOST with Host header until DNS cuts over)."
