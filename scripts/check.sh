#!/bin/sh
# The gate. What CI runs, in order. Any step may stop it.
set -eu
cd "$(dirname "$0")/.."

node --test scripts/*.test.mjs
node scripts/check-urls.mjs
node scripts/check-openapi.mjs
node scripts/snippets.mjs --coverage
node scripts/copy-scalar.mjs
npm run build   # the build itself rewrites tables for focus and the CSP script hashes
node scripts/check-dist.mjs

# Privacy and accessibility run against the built site, served locally on the docs band.
npx astro preview --port 59461 --host 127.0.0.1 &
preview=$!
trap 'kill $preview 2>/dev/null || true' EXIT
for _ in $(seq 60); do curl -sf -o /dev/null http://127.0.0.1:59461/ && break; sleep 1; done
PREVIEW=http://127.0.0.1:59461 node scripts/check-privacy.mjs
# The accessibility gate on the same build: the check first proves it fails a known-bad fixture.
PREVIEW=http://127.0.0.1:59461 node scripts/axe-scan.check.mjs
kill $preview 2>/dev/null || true
trap - EXIT

echo "check: all gates passed"
