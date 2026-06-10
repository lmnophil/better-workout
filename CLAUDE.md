# CLAUDE.md

Self-hosted workout tracker. Single-user or small-group deployment, runs on the user's own hardware via Docker Compose. The user logs sets and reps; the app shows them what they did last time, what muscles they've neglected, and where they are versus weekly volume targets.

This file is the standing brief — read it once at the start of a session, then pull in specific docs as the task earns them. Everything below "Working agreements" is conventions and pointers.

## Working agreements

A few stances that matter more than any specific fact in this document:

**This doc can be wrong.** It's the best understanding at the time it was written. The code is the source of truth. If you find a contradiction, the code wins, and you should update this doc as part of your change. If a decision documented here looks bad to you now, say so — don't quietly work around it. Pushback is welcome.

**Do quality work, but don't gold-plate.** Solves the actual problem, fits the existing style, doesn't introduce premature abstraction. Stay in scope: don't refactor things that weren't part of the request, don't add features that weren't asked for. If you find an unrelated issue, surface it ("I noticed X — want me to handle it now or leave it for later?") rather than silently fixing it.

**Verify, don't assume.** Read the file before editing. Run `npm run typecheck` and `npm run lint` after meaningful changes. Don't assume library APIs from training data — check `package.json` and how the API is used elsewhere. The Next.js 15 + React 19 + Auth.js v5 + Prisma 7 stack has real footguns around older patterns.

**The previous session can be wrong too.** Inheriting a session's direction doesn't mean inheriting its mistakes. If the last thing that happened was a half-finished refactor or a questionable design call, push back rather than continuing it.

## Project status: solo dev, disposable data

The user is the only developer; any data in the database is from their own testing. There are no live users and none planned. Concretely:

- **Database is disposable, permanently.** `prisma migrate reset --force` and `docker compose down -v` are normal tools. You do not need to ask before running them.
- **Don't preserve migration history.** Schema changes squash back into the single `init` migration; see [prisma/CLAUDE.md](prisma/CLAUDE.md).
- **No back-compat shims.** No data-migration glue, fallback fields, deprecation paths, staged rollouts. Just change the code.
- **No multi-user / SaaS hardening.** Rate limiting, session length, etc. are deliberately loose — leave them.

## Destructive Prisma commands require a consent flag

`prisma migrate reset` and `prisma migrate dev` are gated behind `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=<the user's yes-message>`. Run them like:

```bash
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="yes" npx prisma migrate reset --force
```

This is an AI-agent guardrail, not a normal Prisma feature. Full reset recipe and rationale are in [prisma/CLAUDE.md](prisma/CLAUDE.md).

## Verifying UI changes

A Playwright MCP is wired up via `.mcp.json`. Use it to actually drive the dev server in a browser instead of saying "I can't verify the UI." Typechecking is not the same as exercising the feature.

The first time the MCP launches a browser, the user signs in manually in the headed window. The profile persists at `./.playwright-profile/` (gitignored). If the cookie expires or you need to test as a different user, blow that directory away and re-sign in.

If you genuinely can't verify something (no MCP, blocked by an OAuth flow), say so explicitly rather than implying success.

## What goes in docs, and what doesn't

A short rule to keep docs from rotting:

- **In docs:** the _why_ behind a non-obvious choice; invariants that the code can't enforce; gotchas a fresh session would hit blind.
- **Not in docs:** anything `git log` or a `grep` can answer (file paths, action lists, exercise counts, recent changes). Lists like that drift the moment the code moves and quietly mislead future sessions.
- **Rationale that survives a refactor** goes in [`docs/decisions.md`](docs/decisions.md) as an ADR.
- **Operational gotchas** go in the nearest subdirectory `CLAUDE.md`.

When in doubt: if you'd update this doc the same way after every PR, it doesn't belong here.

## Maintenance contract

When you make these kinds of changes, update these docs in the same PR:

- **Schema change** → [prisma/CLAUDE.md](prisma/CLAUDE.md) if invariants shifted, [docs/data-model.md](docs/data-model.md) if relationships changed.
- **New / removed server action category** → [docs/api.md](docs/api.md). Individual action additions don't need a doc update.
- **New HTTP route** → [app/api/CLAUDE.md](app/api/CLAUDE.md) (and the middleware matcher!).
- **A design decision you'd want to remember in 6 months** → new ADR in [docs/decisions.md](docs/decisions.md).
- **Anything that contradicts a doc you read while working** → fix the doc as part of the change.

If a fact lives in one doc and is only referenced from others, that's the goal. Duplication drifts.

## Conventions worth respecting

**Server actions.** Every mutation lives in `lib/actions.ts`, wrapped with `withLogging('actionName', ...)`. Every action: `requireUser()`, Zod-validate inputs, scope by `userId`, `revalidatePath` after mutating. Expected user-facing errors throw `ExpectedError` (`lib/action-result.ts`) — `withLogging` converts them to `{ ok: false, error }` results so the message survives prod's error redaction; plain `Error` logs as a bug and ESLint rejects it in that file. Full recipe in [docs/api.md](docs/api.md), rationale in [docs/decisions.md](docs/decisions.md).

**Queries.** `lib/queries.ts`. Server-side only. Some are `React.cache()`-wrapped for request-scoped dedup. Don't import into client components.

**Client components.** Mark with `'use client'`. Wrap action calls with `useTransition`; show `isPending` state on buttons. For prefs that cross the layout/page boundary, use `PrefsContext` in `components/ui/prefs-context.tsx` — don't prop-drill prefs (see [docs/decisions.md](docs/decisions.md) for why).

**Errors.** Server-side: throw expected errors as `ExpectedError`; clients receive `{ ok: false, error }` and render `res.error` — don't catch-and-read `err.message`, prod redacts it. Only genuine bugs throw through to the nearest `error.tsx` boundary. All boundaries use `useReportError` to ship to `/api/log/client-error`. An expired session redirects to `/signin` from `requireUser` rather than erroring.

**Comments.** Prose paragraphs that explain _why_, not bullets that restate _what_. Match the surrounding voice — direct, doesn't hedge.

**Formatting.** Prettier owns whitespace; ESLint owns rules. Run `npm run format` before committing if you've been editing by hand, or let your editor's Prettier-on-save handle it. The config (`prettier.config.mjs`) is intentionally minimal — single quotes, semis, trailing commas, 100-char lines — to match the existing voice. Don't argue with Prettier; if the output is uglier than the input, the input was usually wrong about line breaks.

**Linting.** `npm run lint` runs ESLint with `next/core-web-vitals` + `next/typescript` + `typescript-eslint` strict + `eslint-config-prettier`. The strict ruleset disallows `!` (non-null assertion) — narrow with a local variable, type predicate, or guard clause instead. If you really need a `!`, you're probably masking a real bug. Use `npm run lint:fix` for autofixes; the rest the rule expects you to fix by hand. New unused vars should be prefixed `_` to opt out of `no-unused-vars`.

## Things you might want to do that would be wrong

- **Add `dayFocus` (or any "type of day" tag) to `WorkoutSession`.** Sessions are records of what happened. The plan lives on the routine via the optional `startedFromRoutineDayId` FK. See [docs/decisions.md](docs/decisions.md).
- **Add streaks, adherence tracking, "you missed Wednesday" nags, or prescriptive ranges.** The app reflects what the user told it; it doesn't coach. See [docs/decisions.md](docs/decisions.md).
- **Stack a new Prisma migration on top of `init`.** Edit the schema and re-reset; the project policy is single-init. See [prisma/CLAUDE.md](prisma/CLAUDE.md).
- **Add a `POST /api/sets` or any HTTP route for app-data mutations.** Use server actions. Routes are for the four system-level cases only. See [app/api/CLAUDE.md](app/api/CLAUDE.md).
- **Hard-delete an `Exercise`.** Soft-delete (`deletedAt`) — `SetLog.exerciseId` is `Restrict` to preserve history. See [prisma/CLAUDE.md](prisma/CLAUDE.md).
- **Add Redux/Zustand/etc.** `PrefsContext` is the only context provider; everything else is server-rendered + revalidation.
- **Add a back-compat shim, fallback field, or staged rollout.** No live users; just change the code.
- **Have a public/share action call `requireUser()`.** The share-side public actions (`registerShareReviewer`, `postShareComment`, `postShareSuggestion`, `toggleShareReaction`) are the only mutations in `lib/actions.ts` that skip `requireUser()` — they authenticate via the share token + per-share reviewer cookie. Don't add `requireUser()` to them and don't copy the no-auth pattern to anything else. See [docs/decisions.md](docs/decisions.md).
- **Make a reviewer's suggestion auto-apply.** Reviewers propose; the owner accepts. Don't add an auto-apply path on the public action side.
- **Add a second public app route without an entry in `PUBLIC_PATHS`.** `/share/[token]` is currently the only one. Anything else under the authenticated layout must stay auth-gated; if you really need a second public surface, add to [middleware.ts](middleware.ts) and the ADR.

## Stack (the bits that aren't in package.json)

Next.js 15 (App Router, Server Actions). TypeScript strict. Prisma 7 + Postgres 16 — Rust query engine is gone, queries run through `@prisma/adapter-pg` (see `lib/db.ts`); generated client lives at `prisma/generated/prisma/client`; CLI config is `prisma.config.ts`, not `package.json#prisma`. Auth.js v5 with Google OAuth + Resend magic links, JWT sessions. Tailwind 3 (no CSS-in-JS). Pino for structured logging. prom-client for metrics. Serwist for PWA. Docker Compose for deployment; TLS is the operator's reverse proxy.

Not used (deliberately): no ORM besides Prisma; no state library; no CSS-in-JS; no Sentry-style error tracking (the `/api/log/client-error` endpoint + Pino is the pipeline); no analytics.

## Index of referenced docs

Pull these in as the task earns them — don't pre-load.

- [`docs/codebase-map.md`](docs/codebase-map.md) — code-grounded reference. Skim when you need to orient. Maintained inline with code changes per the maintenance contract; if you find a claim that no longer matches, fix it as part of your change.
- [`docs/api.md`](docs/api.md) — server-action, query, and HTTP-route conventions plus recipes for adding each.
- [`docs/data-model.md`](docs/data-model.md) — entities, relationships, cross-cutting patterns. Read when touching schema.
- [`docs/decisions.md`](docs/decisions.md) — substantive design decisions and why. Check before undoing or extending a non-obvious choice.
- [`prisma/CLAUDE.md`](prisma/CLAUDE.md), [`app/api/CLAUDE.md`](app/api/CLAUDE.md), [`components/workout/CLAUDE.md`](components/workout/CLAUDE.md), [`scripts/CLAUDE.md`](scripts/CLAUDE.md) — operational gotchas for each area.

## When this doc is wrong

Update it. Same voice, ship it with the change. A doc that's known to be stale is worse than no doc.
