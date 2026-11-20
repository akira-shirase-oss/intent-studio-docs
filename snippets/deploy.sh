# Deploy a built intent-server + intent-worker + workspace to $HOST over ssh, then restart and
# probe. Sourced by the snippets runner on the deployment page; run it the same way by hand:
#   HOST=deploy@203.0.113.10 bash snippets/deploy.sh
set -euo pipefail
: "${HOST:?set HOST=user@host}"
: "${BIN:=target/release}"

# The binaries and the built app.
ssh "$HOST" 'mkdir -p intent-studio/{bin,workspace,var/store}'
scp "$BIN/intent-server" "$BIN/intent-worker" "$HOST:intent-studio/bin/"
rsync -a --delete apps/workspace/build/ "$HOST:intent-studio/workspace/"

# First-boot shape only: the environment file stays on the host (secrets never travel in git or logs).
ssh "$HOST" 'test -f intent-studio/env || printf "%s\n" \
  "INTENT_DATABASE_URL=" "INTENT_OPERATOR_PASSWORD_HASH=" "INTENT_NOTIFY_PROVIDER=webhook" \
  "INTENT_NOTIFY_WEBHOOK_URL=" "INTENT_BIND=127.0.0.1:59400" "INTENT_PROFILE=production" \
  "INTENT_STORE_DIR=$HOME/intent-studio/var/store" "INTENT_WORKSPACE_DIR=$HOME/intent-studio/workspace" \
  "INTENT_WORKER_BIN=$HOME/intent-studio/bin/intent-worker" \
  > intent-studio/env && chmod 600 intent-studio/env'

# Restart under the host's supervisor and probe readiness. systemd shown; adapt to yours.
ssh "$HOST" 'sudo systemctl restart intent-studio && sleep 1 && curl -sf http://127.0.0.1:59400/readyz'
