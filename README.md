# Intent Studio Docs

The documentation for [Intent Studio](https://github.com/akira-shirase-oss/intent-studio), the
self-hosted service that turns a client goal into a working website: the quick start, the workspace
and leads guides, authentication, self-hosting and operations, the API reference, and the changelog.

**Read it at <https://docs.intent-studio.404human.dev>.**

Built with Astro Starlight, deployed to Cloudflare Pages. The product's API is documented with a
first-party [Scalar](https://github.com/scalar/scalar) reference at `/api/reference/`.

## Why this repository checks itself

Documentation that drifts from the code is worse than none, so CI checks the docs against Intent
Studio itself (`.github/workflows/ci.yml`), on every push and every night:

- **Every code block runs.** The pages' commands are executed in order by `scripts/snippets.mjs`
  against an `intent-server` built from intent-studio `main` with the quick start's own commands;
  the block after a command is compared with what the server actually printed (ids, times, secrets
  and hashes normalised). A block that can't run in CI — a systemd unit, a deploy over ssh — says
  so on the page (`not-run="why"`) and `node scripts/snippets.mjs --coverage` fails on any block
  that neither runs nor explains itself.
- **The API reference can't drift.** `src/data/openapi.json` is a draft OpenAPI document authored
  here from the server's real request and response shapes; CI fails when a route in
  `crates/intent-server/src/app.rs` is missing from it, or when it names a route the server does
  not have (`scripts/check-openapi.mjs`). The draft is meant to move into intent-studio, where a
  generated spec replaces it; until then the check keeps the draft honest.
- **Nothing private leaks.** `scripts/check-privacy.mjs` drives the built site in a browser and
  fails on any third-party request; the API reference's Test Request goes only to the server the
  reader chooses, and no credential is persisted anywhere.
- **The output is scanned.** `scripts/check-dist.mjs` fails on a private machine path, a username,
  an internal decision number or an unmasked credential in anything that ships.
- **Accessibility is a gate, not a scan.** `scripts/axe-scan.check.mjs` first proves the scanner can
  find a violation, then every page passes WCAG 2.x plus best-practice rules.

## Working on it

```sh
npm install                  # Node ≥ 22.17
npm run dev                  # local preview
npm test                     # the snippet runner's own tests
npm run build                # build + every output check
node scripts/snippets.mjs    # run every example against the real stack (needs the product + its
                             # services: PostgreSQL via the product's stack.sh, on your port band)
node scripts/snippets.mjs --list         # the steps, without running them
node scripts/snippets.mjs --coverage     # count every block: run, checked output, or not-run reason
bash scripts/check.sh        # everything CI does, locally
```

The examples a reader sees use `https://studio.example.com`, a reserved example domain (RFC 2606);
the pages that run on this machine show `http://127.0.0.1:59400`, the server's own default. At run
time each shown address is swapped for the stack's real one (`--base` maps it onto a port band), so
the snippets run anywhere an Intent Studio does — a developer's machine in its allotted band, CI on
its own.

## Content rules

- Say what Intent Studio does on `main` today. Something not built yet is left out, or marked as
  roadmap.
- Examples on hosted pages call `https://studio.example.com`. A local example lives on the quick
  start and the self-hosting pages — listed in `scripts/check-urls.mjs` — and says it's on this
  machine.
- No secrets, machine paths, usernames, internal decision numbers or commit hashes in pages or
  output. Credentials are always elided (`intent_operator=…`, `<hash>`).

## Deploying

Cloudflare Pages, project `intent-studio-docs`:

```sh
npm run build
npx -y wrangler pages deploy dist --project-name intent-studio-docs --branch main
npm run check:live -- https://docs.intent-studio.404human.dev   # headers, search, the reference, the feed
```

## License

MIT, like Intent Studio.
