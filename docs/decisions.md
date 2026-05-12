# Decisions

The substantive design decisions made on this project, with the reasoning. Entries are appended over time. If you reverse a decision, don't delete the old entry — add a new one explaining why we changed our minds.

**Brief vs detailed.** Promote a decision to the **Detailed** section when *any* of these hold: alternatives were genuinely worth considering, the call could plausibly be reversed under named circumstances, or a future session would re-litigate it without the context written down. Everything else stays in the **Brief list** as a one-or-two-sentence entry, ideally with an inline "reverse if…" clause when there's a real trigger.

---

## Brief list

These are decisions worth knowing but where the rationale is summarizable in a sentence or two:

- **TypeScript strict, no looseness.** The types in this codebase carry real weight — server-action input validation, Prisma model shapes, JWT augmentation. Strict mode catches the bugs that matter.
- **Tailwind, no CSS-in-JS.** Tailwind handles 95% of needs and stays out of the way. The custom design tokens (`accent-text`, `accent-bg`, ink color scale) cover the rest. Avoid emotion, styled-components, and friends.
- **Pino over winston/bunyan.** Faster, cleaner JSON output, redact config is straightforward. Outputs to stdout; Docker captures.
- **In-memory rate limiter.** Single-instance deployment. Redis-backed limiter is a future migration if/when we go multi-instance — call sites stay the same.
- **Soft-delete for custom exercises.** `deletedAt` rather than hard delete preserves SetLog history. Built-in exercises are never deleted.
- **`cuid()` for IDs, not UUIDs.** Sortable by creation time, shorter, Prisma's default.
- **Set/rep prescription on the Exercise stays free-text.** `Exercise.prescription` is shared across every template that uses the exercise — keep it human-readable ("3×12, 5-sec hold") rather than structured. *Per-template* planning is a different story, see "Per-template planned sets and reps" below.
- **Sessions auto-clean when emptied.** A session with zero sets is deleted, not preserved. Avoids the "phantom in-progress workout" UX. *Reverse if* users complain about losing a just-started session by accident.
- **Active session is one-at-a-time.** Enforced by the app, not the database. Convention: at most one `WorkoutSession` per user with `completedAt: null`. The schema doesn't have a partial unique constraint on this — `findFirst` ordered by date keeps it deterministic if a race ever creates two.
- **Recency windows on coverage and last-sets queries.** 90 days for coverage, 180 for last-sets. The UI gradient maxes at 7 days neglected; older sessions render identically. Last-sets after 6 months is more confusing than helpful. Bounds memory growth.
- **`React.cache()` on `getUserPreferences`.** Both layout and (formerly) page wanted it; cache de-duplicates the DB hit. Now layout is the only caller, but the cache stays.
- **Muscle IDs use spaces** (`'rear delts'`, `'lower back'`). Cosmetic — chosen for label-readability when seed data is being authored. URL/debug output sometimes needs quoting; lived with. *Reverse if* muscle IDs ever appear in URL paths and the quoting friction outweighs the seed-readability win.
- **Plain SQL gzipped backups.** Human-readable, partially restorable, no `pg_restore` needed. Tradeoff is larger files. Custom format is the right call once the DB grows to GB-scale; we're not there.
- **Backups not encrypted at rest.** The user's offsite pipeline handles encryption. Doing it twice complicates restore.
- **`x-logging` anchor in compose with json-file rotation.** All services share the same rotation policy. Compatible with future log shippers.

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

**Context.** Most splits a user might bring in (their own, a coach's, a common template like PPL or Upper/Lower) have named days — "Lower 1", "Lower 2", "Upper", "Balance", "Push", "Pull", and so on. The original instinct was to add `dayFocus: string` to `WorkoutSession` to capture that label.

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

### Routines: user-authored cycles, not app-prescribed plans

**Context.** Templates capture a single workout's lineup. Users with a fixed training rotation (4-day split, push/pull/legs, etc.) wanted to express the *cycle* — "after Lower I do Upper, then Trunk, then loop." Earlier docs said "if we ever add a recommendation feature, it grows from coverage data, not from a stored plan." A routine is a stored plan.

**Decision.** Add a `Routine` model (one per user) with an ordered list of `RoutineDay` rows that each point at an existing template. Two scheduling modes:

- **`sequence`** — self-paced cycle. A `lastCompletedPosition` cursor advances when a session started from the routine is completed via `completeActiveSession`. "Today's day" = `(lastCompletedPosition + 1) mod days.length`.
- **`weekday`** — each day is pinned to a weekday (0-6, unique per routine). Calendar drives "today's day"; no cursor.

The workout page's empty state grows a routine timeline (recent + today + upcoming) when a routine exists; without one, the existing template list + picker remains. The active-session UI is unchanged. Capped at 7 days per routine to keep the timeline UI bounded; weekday mode is naturally bounded the same way.

The framing matters: a routine is a *representation* of the user's own cycle, not a recommendation engine. The UI says "Up next" / "Today," not "you should do." There are no streaks, adherence tracking, or nag-on-skip behaviors. Coverage remains the muscle-level signal. The user can always start an ad-hoc session or pick a different day.

**Alternatives considered.**
- *Don't build it.* The "stored plan that produces 'do this next' suggestions" framing was real tension. Considered simpler shapes — just an ordered list of templates, no cursor, no "Up next." Lighter; also less useful. The user's own framing ("the app reflects what you told it") closed the loop on the stance: representing a user-declared cycle isn't the same as the app inventing one.
- *`dayFocus` on `WorkoutSession`* (still rejected). Sessions remain records. The cycle lives on the routine; the session just records what happened, with an optional FK back to the routine day it was started from. Decoupled state.
- *Multiple routines per user.* One routine per user is the cap. Switching routines means editing yours. Multiplicity adds active-routine selection complexity for a single-operator app; deferred.
- *Prescriptive scheduling features* (rest-day reminders, "you missed Wednesday" callouts). Hard no — directly conflicts with the neutral-tool stance.

**Why it stays.** Templates were always plans; routines are the same kind of object scaled up to a cycle. The schema cost is small (3 models + 1 nullable FK), the cursor model is honest about how training really progresses (next-in-sequence, not calendar-shame), and the cap on size keeps the UI predictable.

**Reverse if.** Users adopt routines and find the cap too tight (rotate to weekday mode, or revisit the cap). Or the next-in-sequence model fights actual usage — e.g. people skipping arbitrary days and wanting the cursor to track which one they actually did, not just advance — in which case the cursor probably becomes a `lastCompletedDayId` rather than a position.

### Cross-method account linking by verified email

**Context.** Auth.js v5 supports Google OAuth and email magic links as separate providers. By default, signing up with one provider and later attempting the other for the same email throws `OAuthAccountNotLinked` — the user is locked out of their own account from the alternate path. Auth.js's `allowDangerousEmailAccountLinking` flag bypasses this, but the "dangerous" label exists for good reasons.

**Decision.** Set `allowDangerousEmailAccountLinking: true` on the Google provider. A user who signed up via magic link can later sign in with Google (and vice versa) without account-linking errors.

**Why this is safe here.** The "dangerous" warning targets account-takeover via *unverified* email. The classic attack: an attacker creates an OAuth account with a fake `email_verified: true` claim using a provider that doesn't actually verify, then "links" to a victim's existing account. Neither of our providers has that hole:

- **Google** verifies email ownership before issuing OAuth tokens — `email_verified: true` from Google is real.
- **Resend magic links** require the user to click a link delivered to their inbox, so signing in via magic link proves current control of the address.

Both providers therefore prove "I currently control this email" at sign-in time. Linking them is safe because either provider already establishes the trust the other needs.

**Alternatives considered.**
- *Leave the default behavior on.* Means a user who signs in once with magic link can never use the Google button for the same address without manual intervention. Real friction; no security benefit given our verified-email-on-both-sides setup.
- *Manual linking UI.* Build a settings screen where the user explicitly links their second provider. Overengineered — the flag already produces the right behavior given our threat model.

**Why it stays.** Removes a sign-in dead-end for a self-host audience that has no incentive to attack themselves. The verified-email property of both providers is load-bearing — if either ever gets swapped for a provider that doesn't verify email, this decision flips.

**Reverse if.** A password-based signup is added (passwords + linking-by-email = the classic vulnerability), or either provider is replaced with one that doesn't gate on a verified email.

### Per-template planned sets and reps

**Context.** The app originally kept set/rep prescription as a free-text string on `Exercise` (`"3×12, 5-sec hold"`) and explicitly resisted structuring it ("No prescriptive workout ranges"). That stance held when each exercise had one canonical prescription, and templates were just ordered lists. Once routines landed and each routine day owned its own template, users started wanting per-day planning: "squats 4×6 on Lower 1, 3×10 on Lower 2." With one shared `Exercise.prescription` per exercise, there was nowhere to put that.

There was a deeper tension too: the routine editor showed no way to author the *plan* portion of a plan. You could pick which exercises went where, but not how much you intended to do. Users were filling that in only at session-start time, in a context where they couldn't see the whole week's volume balance.

**Decision.** Add `plannedSets: Int?` and `plannedReps: Int?` to `TemplateExercise` (the junction row between a template and an exercise). Both nullable so existing rows and quick-pick flows can leave them blank. They feed the seeder:

- Set count: history > `plannedSets` > parsed `Exercise.prescription` ("3×12" → 3) > `defaultSetsPerExercise` preference
- Reps: history > `plannedReps` (only when no history exists) > null

The `Exercise.prescription` text remains and stays free-form — it's the *cross-template* note ("ATG depth, 5s eccentric"). Per-template numbers are the *plan for this slot in this routine*.

The UI shows two small "—×—" inputs next to each exercise in the routine editor's day cards. Empty means "not planned"; the seeder falls through. A structural coverage panel underneath the days projects total weighted sets per muscle across one full cycle, comparing to the user's volume targets.

**Alternatives considered.**
- *Keep the free-text-only stance.* Means the app can never reflect "here's the volume I'm planning for this muscle." The Coverage view becomes purely retrospective; users can't sanity-check a routine before running it. We considered building the panel using the prescription's parsed `N×M` and the global `defaultSetsPerExercise` only, but that's a single shared knob — it can't express "more squats on Lower 1 than Lower 2."
- *Rep ranges (`repsLow`/`repsHigh`).* Tempting for hypertrophy programming where 8–12 is more honest than 10. But the UX cost is real: two inputs per exercise, decisions about how to seed sets ("which end of the range?"), and we'd be inventing taxonomy the rest of the app doesn't use. A single number is closer to how users currently log (one rep field per set), and the free-text `Exercise.prescription` is still there for users who want to remind themselves of a target range.
- *Planned weight too.* No — weight is the most history-sensitive number and progressive overload is the whole point. Letting users author a target weight conflicts with "history wins" in a way sets/reps don't.

**Why it stays.** Templates were always plans; this just lets users author the numerical part of the plan they were already declaring with their exercise lineup. It doesn't touch the neutral-tool stance — the user authors the numbers, the app represents them back. The seeder's history-first ordering means once you've actually done the workout, your real numbers replace the planned ones — the plan is a starting point, not a prescription.

**Reverse if.** Users want rep *ranges* badly enough that the single-number model gets in the way (then `plannedReps` becomes `plannedRepsLow`/`plannedRepsHigh` with an Int alias for the common case). Or — the opposite — nobody uses the per-template numbers and they sit null forever, in which case strip the columns and revert to prescription-only.

### Prefs come from a context provider, not from props

**Context.** Both the workout page and the app shell header (cue toggle) need to read and write the same user prefs (rest-timer enabled, seconds, sound, vibrate). The initial implementation drilled a `preferences` prop into `WorkoutView` and held parallel local state in the header. The two desynced — toggling the rest-timer in the workout view didn't update the header cue toggle until the next server revalidation, because each surface had its own copy of the same data.

**Decision.** Move prefs into `PrefsContext` (`components/ui/prefs-context.tsx`), provided at the app layout level. Both surfaces consume via `usePrefs()`; the settings page editor reads from the same context. Updates flow through `updatePrefs()`, which patches local state and calls the `updateUserPreferences` server action in one call. The settings page, the workout view, and the header cue toggle all stay in sync.

**Alternatives considered.**
- *Keep prop-drilling.* The pattern that caused the bug. Across a layout/page boundary, every consumer maintains its own copy of the same prop, and there's no built-in mechanism for one consumer's update to flow to a sibling.
- *Server state only, no context.* Workable, but every toggle round-trips through `revalidatePath` before the UI reflects the change. Sluggish for a setting the user flips mid-workout.
- *A global state library (Redux, Zustand, Jotai).* Overkill for a single shared object. Adds a dependency and a vocabulary the rest of the app doesn't use.

**Why it stays.** `PrefsContext` is intentionally the *only* client-side context provider in the app. The rule it represents: shared *mutable* state that crosses the layout/page boundary uses context; everything else (which is almost everything) server-renders and revalidates. If you find yourself reaching for a second provider, check whether the data really needs to be mutable across boundaries — usually a server query is enough.

**Reverse if.** A second concern develops the same shape (mutable, crosses the boundary, can't tolerate a server round-trip) and a more general pattern would be cleaner than two ad-hoc providers. Or React / Next.js evolves a primitive that makes this kind of share trivial without provider boilerplate.
