# Intent Studio Docs — agent instructions

The docs site for [intent-studio](https://github.com/akira-shirase-oss/intent-studio), built with
Astro Starlight and deployed to Cloudflare Pages as `docs.intent-studio.404human.dev`. The product
repository is read-only reference for this worktree; never edit it from here.

## The model (same as the sibling docs sites)

- `src/content/docs/*.mdx` are the pages. Code fences carry test markers: `run=<suite>` executes,
  `output=<suite>` must match the real server (normalised), `not-run="why"` explains a block that
  cannot run. `node scripts/snippets.mjs --coverage` fails on any unmarked block.
- Suites run against an `intent-server` built from the product's `main` with the quick start's own
  commands (PostgreSQL via its compose stack). Hosted pages show `https://studio.example.com`
  (RFC 2606); the pages that run on this machine show `http://127.0.0.1:59400` and say so — the
  list lives in `scripts/check-urls.mjs` (`ALLOWED`) and `scripts/snippets.mjs` (`LOCAL_PAGES`,
  `MAPPINGS`). Keep them aligned.
- `src/data/openapi.json` is a **draft** authored here from the server's real handlers;
  `scripts/check-openapi.mjs` keeps it bidirectionally in sync with the routes in
  `crates/intent-server/src/app.rs`. It moves into the product repository once reviewed.
- `scripts/check.sh` is the gate before every push: node tests, the accessibility scan's self-test,
  snippet coverage, `npm run build` (internal links, CSP hashes, the output checks), privacy on a
  local preview, no home paths in tracked files.

## Non-negotiables

- No secrets, real hostnames, home paths, user names, commit hashes or internal decision numbers in
  anything committed (public repo). The only real hostname allowed is
  `docs.intent-studio.404human.dev`. `scripts/check-dist.mjs` enforces most of this in the output.
- Every example runs in CI or carries a `not-run` reason. Never fake an output block.
- Say what the product does on `main` today; roadmap items are marked as such — never documented
  as existing.
- Neutral theme: Starlight tokens only, no product palette — a shared design system is coming.
- Small commits on `main`; the coordinator reviews and pushes.

## Verification

`scripts/check.sh` before every commit that touches pages, scripts or config; `npm run build`
before any commit, always.
