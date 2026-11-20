---
title: The studio API and the workspace
date: 2026-11-20
type: Feature
areas: [API, Workspace, Intake, Store, Self-hosting]
docs:
  - { label: 'Quick start', href: '/quick-start/' }
  - { label: 'Concepts', href: '/concepts/' }
  - { label: 'The workspace', href: '/workspace/' }
---

The first milestone is live: an operator can sign in and run a studio of clients end to end, and a
published site's form can deliver a lead that survives the notifier being down.

**The studio API.** Tenants, facts with their approve/stale/withdraw lifecycle, revisioned briefs,
`spec-check` — which validates a page tree against the brief and today's facts before anything
renders — and assets stored content-addressed so what you read back provably is what was written.

**The workspace.** A single-page app on the server's own origin: sign-in, tenants, the fact and
brief editors, assets, and the lead inbox. No CORS, no tokens in storage — the session cookie does
everything.

**Lead intake.** `POST /v1/sites/{site}/leads` commits a lead and its notification outbox row in
one transaction; resubmission is idempotent, limits are enforced, and an acknowledged lead can't be
lost to a down webhook.

Also in this release: the content store is crash-safe and single-writer (orphaned writes are swept,
torn blobs can't pass as valid), sign-in is rate-limited per address, and every surface is covered
by load evidence and failure drills in the product repo.
