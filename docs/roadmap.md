# Roadmap

What we've discussed and deliberately deferred. Read this before suggesting features — most of the obvious ideas have already been considered, and the reason they're not built is usually more interesting than the idea itself.

If you have a new idea not on this list, that's worth surfacing. If your idea *is* on this list, the question becomes: has the situation changed in a way that affects the original reasoning?

## Probably worth doing eventually

Roughly in order of value-per-effort.

**Per-set notes in the "last time" reference.** Done — notes are written and surfaced. (Listed here so future sessions don't re-add it.)

**External uptime monitoring.** The Docker healthcheck only catches container-internal failures. An external probe (Uptime Kuma self-hosted on a different machine, or BetterStack free tier for a single endpoint) would catch host-level outages, DNS issues, and expired certificates. No code changes needed — just point a probe at `/api/healthz`.

**End-to-end deploy test on a fresh VM.** The audits caught everything visible in the code. Only an actual deploy from scratch catches the last 5% — typos in DEPLOY.md, host-vs-container path confusions, permission gotchas on `BACKUP_HOST_DIR`. Worth doing once before considering the app "production."

**Personal records, auto-detected.** When a session completes, check if any set was a 1RM, 5RM, or rep-PR for that exercise. Surface as a small icon on the session and on the exercise card. Zero user effort, motivating, builds on data already collected. Schema-light: probably a derived view rather than a stored table.

**Bodyweight tracking.** One number per day. Trivial schema. Unlocks ratio metrics later (relative strength, sane interpretation of weight progression during cuts/bulks). Input on the workout page header so logging is one tap.

**Plate calculator.** Given a target weight and bar weight, show the plate combinations. Glanceability mid-set when the user is foggy. Tiny feature.

**Workout calendar / streak heatmap.** Visual pattern recognition for consistency. Probably also where bodyweight chart would live.

**Data export.** CSV or JSON dump of all the user's data. Self-hosting makes this partly redundant with raw DB access, but a one-click "download my data" matters for portability.

**Dev-mode `docker-compose.override.yml`.** Volume-mount source, run `next dev` instead of standalone, debug-level logging, etc. So testing the full stack locally is one command. Not urgent — the existing `npm run dev` against a local Postgres works fine.

## Discussed but deliberately deferred

Things we've thought about and chose not to build, with the reasoning. If you want to revisit, the question is whether the underlying situation has changed.

### PT/sharing features

**The brainstorm.** Two paths discussed:
1. *Lightweight share link.* Read-only token, PT visits a URL, sees recent sessions and coverage. No PT account needed. Cheap to build, no auth coupling, but PT can't actually do anything beyond observe.
2. *Trainer relationship.* PT has their own account, user grants them access. PT can view history and propose template revisions. The interesting design surface is "partial accept" of proposed revisions — like code review for workout plans, where the user can ✓ or ✗ each proposed change independently. Templates would need versioning to support this; the current schema (per-exercise rows with positions) is already structured enough that a granular diff is feasible.

**Why deferred.** Premature without real-world use. The interesting design questions (revision UX, what "partial accept" means concretely, how to model "proposed by PT vs. accepted by user") only have good answers once we've watched a real user-PT pair work together for a few weeks. Building it earlier risks making decisions that look reasonable in the abstract but feel wrong in use.

**Don't build it speculatively.** Building partial pieces ("just the data model for now") still hardens design choices that should stay fluid.

### Multi-user / SaaS hardening

Things we'd need for a hosted multi-tenant version that would actively hurt the self-hosted single-user model:

- **Redis-backed rate limiter.** Adds a service. The in-memory limiter is right for one container.
- **Database sessions instead of JWT.** Adds a DB hit per request. JWT-1-year is the right call here — see `decisions.md`.
- **Strict 30-day session expiry.** User-hostile for a fitness tracker.
- **Email change verification flows, account deletion UX, GDPR export tooling.** Real for SaaS, overkill here.

If the project ever pivots to hosted, these come back on the table together — not piecemeal.

### Recommendation engine / "what should I do today"

Tempting because we have all the data (coverage, last sessions, volume targets). Deliberately not built because it crosses the line from "neutral tool" to "prescriptive coach." The Coverage view's color gradient *is* the recommendation — neglected muscles show red. That's the right amount of nudge.

If a request seems to want a recommendation feature, push back: what's wrong with how Coverage already nudges? Usually the answer reveals a UX problem with Coverage that's worth fixing directly.

### Social features

Friends, feeds, leaderboards, sharing. Not the app this is. If a user wants social fitness, there are apps for that.

### "Workout streaks"

Discussed under the calendar/heatmap feature. The heatmap is fine — just a visualization. A streak *counter* with motivational copy ("Don't break your streak!") would push the app toward gamification, which conflicts with the neutral-tool stance. Show the data; let the user draw conclusions.

## Things that would change the current design

These would require deliberate revisits to documented decisions:

- **Multi-instance deployment.** Triggers Redis-backed rate limiter, possibly db-backed sessions, maybe `pg_dump --format=custom`.
- **External users (not just operator's friends/family).** Triggers shorter sessions, GDPR tooling, account deletion, real password recovery flows beyond magic links, abuse rate limits, etc.
- **DB size > a few GB.** Triggers `pg_dump` custom format, parallel dumps, possibly a separate read replica.
- **Mobile-native app.** Triggers an actual API surface (vs. server actions), proper API versioning, OAuth flows for the native client.

None of these are happening soon. Each one, if it does, deserves its own design pass.
