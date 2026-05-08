# Decisions

The substantive design decisions made on this project, with the reasoning. Entries are appended over time. If you reverse a decision, don't delete the old entry — add a new one explaining why we changed our minds.

---

## Brief list

These are decisions worth knowing but where the rationale is summarizable in a sentence or two:

- **TypeScript strict, no looseness.** The types in this codebase carry real weight — server-action input validation, Prisma model shapes, JWT augmentation. Strict mode catches the bugs that matter.
- **Tailwind, no CSS-in-JS.** Tailwind handles 95% of needs and stays out of the way. The custom design tokens (`accent-text`, `accent-bg`, ink color scale) cover the rest. Avoid emotion, styled-components, and friends.
- **Pino over winston/bunyan.** Faster, cleaner JSON output, redact config is straightforward. Outputs to stdout; Docker captures.
- **In-memory rate limiter.** Single-instance deployment. Redis-backed limiter is a future migration if/when we go multi-instance — call sites stay the same.
- **Soft-delete for custom exercises.** `deletedAt` rather than hard delete preserves SetLog history. Built-in exercises are never deleted.
- **`cuid()` for IDs, not UUIDs.** Sortable by creation time, shorter, Prisma's default.
- **No prescriptive workout ranges.** Set/rep prescription is a free-text string on the Exercise. Don't try to structure it.
- **Sessions auto-clean when emptied.** A session with zero sets is deleted, not preserved. Avoids the "phantom in-progress workout" UX.
- **Active session is one-at-a-time.** Enforced by the app, not the database. Convention: at most one `WorkoutSession` per user with `completedAt: null`. The schema doesn't have a partial unique constraint on this — `findFirst` ordered by date keeps it deterministic if a race ever creates two.
- **Recency windows on coverage and last-sets queries.** 90 days for coverage, 180 for last-sets. The UI gradient maxes at 7 days neglected; older sessions render identically. Last-sets after 6 months is more confusing than helpful. Bounds memory growth.
- **`React.cache()` on `getUserPreferences`.** Both layout and (formerly) page wanted it; cache de-duplicates the DB hit. Now layout is the only caller, but the cache stays.
- **Muscle IDs use spaces** (`'rear delts'`, `'lower back'`). Cosmetic — chosen for label-readability when seed data is being authored. URL/debug output sometimes needs quoting; lived with.
- **Plain SQL gzipped backups.** Human-readable, partially restorable, no `pg_restore` needed. Tradeoff is larger files. Custom format is the right call once the DB grows to GB-scale; we're not there.
- **Backups not encrypted at rest.** The user's offsite pipeline handles encryption. Doing it twice complicates restore.
- **`x-logging` anchor in compose with json-file rotation.** All services share the same rotation policy. Compatible with future log shippers.
- **Cross-method account linking by verified email.** `allowDangerousEmailAccountLinking: true` is set on the Google provider so a user who signed up via magic link can later sign in with Google (and vice versa) without hitting `OAuthAccountNotLinked`. Safe here because both of our providers gate on a verified email — Google verifies before issuing tokens, and Resend magic links require clicking a link delivered to the inbox. The "dangerous" warning applies to providers that don't verify emails or to password signups; we have neither.

---

## Detailed decisions (ADR-style)

These are calls where the alternatives are genuinely worth remembering, in case the situation ever changes.

### Multi-muscle credit: weighted, not all-or-nothing

**Context.** Many exercises (deadlifts, squats, RDLs) work multiple muscle groups, but unevenly. We needed to capture "you made *some* progress on these other muscles" without claiming a deadlift is fully a hamstring exercise.

**Decision.** Each `Exercise` has `primaryMuscles[]` and `secondaryMuscles[]`. Each set credits primary at 1.0, secondary at 0.5. The Coverage view's *recency* (when you last touched a muscle) treats both equally — touching at all freshens it. The *volume* count is weighted.

**Alternatives considered.**
- *All muscles equal (single `muscles[]` array).* Simpler, but inflates volume claims. Doing only RDLs would credit your back as fully as it credits your hamstrings. Misleading.
- *Primary only, no secondary.* Lose the "I did get some shoulder work from overhead pressing" signal that motivates rest-day choices. Coverage view goes red on muscles that are actually being touched.
- *Configurable weights per exercise.* Overkill — gives users a knob they don't want, and the half-credit heuristic is good enough.

**Why it stays.** Captures real-world training honestly without requiring users to think about it.

### JWT session lifetime: 1 year

**Context.** Auth.js v5 supports both database sessions and JWT sessions. JWT sessions don't require a DB hit on every request. We had to choose a `maxAge`.

**Decision.** JWT strategy with `maxAge: 60 * 60 * 24 * 365` (1 year), `updateAge: 60 * 60 * 24` (refresh cookie at most daily on activity).

**Alternatives considered.**
- *30-day or 90-day expiry.* Standard for SaaS. But this is a fitness tracker — a user who returns from a 4-month hiatus shouldn't be greeted by a sign-in wall. Friction at exactly the wrong moment.
- *Database sessions.* Would let us invalidate centrally on demand. But adds a DB hit per request and complicates middleware (which runs Edge-side, can't hit Postgres).

**Why it stays.** This is a workout tracker, not a banking app. The tradeoff is: if the JWT signing key (`AUTH_SECRET`) ever leaks, every existing session is forgeable until rotation. Mitigation: rotation is a single env var change, documented in DEPLOY.md.

**Reverse if.** We add multi-user features where a compromised account can affect others, or any kind of admin/moderation surface.

### Don't store "type of day" on a WorkoutSession

**Context.** Edwardo's program has named days (Lower 1, Lower 2, Upper, Balance). The original instinct was to add `dayFocus: string` to `WorkoutSession`.

**Decision.** Don't. A session is a date and a list of sets. The "what kind of day was this" is implicit in which exercises you logged, and the user knows what they did.

**Alternatives considered.**
- *`dayFocus` enum.* Forces the user into a fixed taxonomy, defeats the "tool, not prescription" stance.
- *`dayFocus` free-text.* Inconsistent across sessions, hard to aggregate, easy to forget to fill in.
- *Tags.* Flexible, but no actual feature uses them. YAGNI.

**Why it stays.** The Coverage view shows the user what they've done at the muscle level — they don't need a self-applied label. Templates (added later) cover the "I want to repeat a known lineup" case without forcing taxonomy.

**Reverse if.** A clear feature need emerges that requires it (e.g. "show me all my Lower 1 sessions"). Don't add it speculatively.

### Backups: plain SQL gzip, not encrypted at rest

**Context.** Decided against three things at once: pg_custom format, in-app encryption, in-app offsite shipping.

**Decision.**
- `pg_dump --format=plain --no-owner --no-privileges | gzip -9` to a host-mounted directory.
- Local files unencrypted.
- The user's existing offsite pipeline picks up the directory and handles encryption, transit, and long-term retention.

**Alternatives considered.**
- *Custom format (`pg_dump -Fc`).* Smaller, parallel restore. But requires `pg_restore`, less inspectable. For our DB size, plain wins on simplicity.
- *In-app encryption (e.g. `gpg`-encrypt the dump).* Doubles the encryption surface — now we have two keys to manage and a restore path that involves both. The user already has a working encryption setup with key escrow they trust. Don't replace working machinery.
- *In-app offsite shipping (rclone, restic, etc).* Same argument — duplicates infrastructure the user already owns. Also adds ongoing dependency management for what should be a "drop a file in a folder" interface.

**Why it stays.** Honoring an explicit user preference. The local directory is the integration point; everything beyond it is the user's pipeline.

**Reverse if.** A user without an offsite pipeline adopts this stack. Then in-app shipping (probably restic to S3-compatible storage) becomes the right add. Encryption-at-rest of the local file would still be optional since the offsite tier handles it for the canonical copy.

### One active session per user, app-enforced not DB-enforced

**Context.** The app convention is "at most one `WorkoutSession` per user with `completedAt: null`." We could enforce this in the schema with a partial unique index (Postgres supports `CREATE UNIQUE INDEX ... WHERE completedAt IS NULL`).

**Decision.** Don't. Enforce in the app: `findActiveSession()` always orders by date desc and takes the first. `getOrCreateActiveSession()` is the only path that creates one; it checks first.

**Alternatives considered.**
- *Partial unique index.* Would catch races at the DB level. Two strikes against: (a) Prisma's support for partial unique indexes is limited and historically painful (`@@unique` doesn't take a `where`); (b) the failure mode under contention is a user-visible "unique constraint violation" error, which is worse than just deduping.
- *Application-level lock (advisory lock or row lock).* Heavy machinery for a problem that's vanishingly rare in single-user practice.

**Why it stays.** The race is theoretical (one user clicking "start workout" in two tabs simultaneously). In the worst case we end up with two active sessions; `findActiveSession()` deterministically picks one and the other becomes unreachable but harmless.

**Reverse if.** We see actual evidence of duplicate active sessions in production (check the logs).
