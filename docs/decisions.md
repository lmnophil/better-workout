# Decisions

The substantive design decisions made on this project, with the reasoning. Entries are appended over time. If you reverse a decision, don't delete the old entry — add a new one explaining why we changed our minds.

**Brief vs detailed.** Promote a decision to the **Detailed** section when _any_ of these hold: alternatives were genuinely worth considering, the call could plausibly be reversed under named circumstances, or a future session would re-litigate it without the context written down. Everything else stays in the **Brief list** as a one-or-two-sentence entry, ideally with an inline "reverse if…" clause when there's a real trigger.

---

## Brief list

These are decisions worth knowing but where the rationale is summarizable in a sentence or two:

- **TypeScript strict, no looseness.** The types in this codebase carry real weight — server-action input validation, Prisma model shapes, JWT augmentation. Strict mode catches the bugs that matter.
- **Tailwind, no CSS-in-JS.** Tailwind handles 95% of needs and stays out of the way. The custom design tokens (`accent-text`, `accent-bg`, ink color scale) cover the rest. Avoid emotion, styled-components, and friends.
- **Pino over winston/bunyan.** Faster, cleaner JSON output, redact config is straightforward. Outputs to stdout; Docker captures.
- **In-memory rate limiter.** Single-instance deployment. Redis-backed limiter is a future migration if/when we go multi-instance — call sites stay the same.
- **Soft-delete for custom exercises.** `deletedAt` rather than hard delete preserves SetLog history. Built-in exercises are never deleted.
- **`cuid()` for IDs, not UUIDs.** Sortable by creation time, shorter, Prisma's default.
- **Set/rep prescription on the Exercise stays free-text.** `Exercise.prescription` is shared across every template that uses the exercise — keep it human-readable ("3×12, 5-sec hold") rather than structured. _Per-template_ planning is a different story, see "Per-template planned sets and reps" below.
- **Sessions auto-clean when emptied.** A session with zero sets is deleted, not preserved. Avoids the "phantom in-progress workout" UX. _Reverse if_ users complain about losing a just-started session by accident.
- **Unfilled sets are pruned at completion.** `completeActiveSession` deletes SetLogs with `reps` and `seconds` both null before recording the session, then renumbers survivors so `setNumber` stays contiguous. Volume/coverage/usage stats count rows, so a seeded-but-never-touched set (a picker-add with no history, or a slot left blank) would otherwise credit work that never happened. The line is deliberately "no value at all," not the time-estimate's metric-aware `isSetFilled` (`> 0`): a row pre-filled from history or the day's plan reads as "did the planned set," and an explicitly-zeroed set is kept as a logged attempt. If the prune empties the whole session, it's discarded like any empty workout (the routine cursor doesn't advance). _Reverse if_ we ever want empty seeded rows to survive as a "planned but skipped" record — but that's the prescriptive-tracking the app avoids.
- **Active session is one-at-a-time.** Enforced by the app, not the database. Convention: at most one `WorkoutSession` per user with `completedAt: null`. The schema doesn't have a partial unique constraint on this — `findFirst` ordered by date keeps it deterministic if a race ever creates two.
- **Recency windows on coverage and last-sets queries.** 90 days for coverage, 180 for last-sets. The UI gradient maxes at 7 days neglected; older sessions render identically. Last-sets after 6 months is more confusing than helpful. Bounds memory growth.
- **`React.cache()` on `getUserPreferences`.** Both layout and (formerly) page wanted it; cache de-duplicates the DB hit. Now layout is the only caller, but the cache stays.
- **Muscle IDs use spaces** (`'rear delts'`, `'lower back'`). Cosmetic — chosen for label-readability when seed data is being authored. URL/debug output sometimes needs quoting; lived with. _Reverse if_ muscle IDs ever appear in URL paths and the quoting friction outweighs the seed-readability win.
- **~~Plain SQL gzipped backups / not encrypted at rest.~~** _Superseded (2026-06-21) by the "Postgres → SQLite" ADR: the move to SQLite removed the `pg_dump` backup service entirely. The DB is now a single file backed up by safe file-copy; the operator's offsite pipeline still owns encryption + retention._
- **`x-logging` anchor in compose with json-file rotation.** All services share the same rotation policy. Compatible with future log shippers.
- **Duplicate-day clones everything except weekday.** `duplicateRoutineDay` carries the name, label, description, and the full TemplateExercise lineup (planned numerics + note included), but always sets `weekday: null` on the new day. Reasoning: when the user duplicates, they almost always want to pin the clone to a _different_ day. Inheriting the source's weekday would either silently overwrite an existing pin (via the unique `(routineId, weekday)` constraint failing or some merge) or quietly land on an unintended day. Forcing the user to pick is one extra click that catches the foot-gun. _Reverse if_ this turns out to feel like a papercut for users who actually want same-weekday clones — likely never, since two days sharing a weekday isn't a supported state.
- **Stale-cookie recovery via `/api/auth/recover`.** When the (app) layout's `auth()` returns null despite the JWT cookie being parseable — almost always because `prisma migrate reset` wiped the User row the JWT points at — the layout redirects to `/api/auth/recover` instead of `/signin` directly. The recover route expires every session-token cookie the request carries (base, `__Secure-` prefixed, and the numbered `.0/.1` chunks Auth.js emits for large JWTs) then bounces to `/signin`. Why the indirection: the JWT callback in `auth.ts` can return null to invalidate the session for a single request, but it has no way to mutate response cookies, so middleware (Edge config, can't hit the DB) keeps seeing the cookie as valid and a direct `/signin` redirect loops between the middleware bounce and the layout redirect. The route handler is the one place that can actually clear the cookie. The expiry must mirror Auth.js's own cookie options — crucially `Secure` for the `__Secure-`-prefixed name, since browsers reject any `Set-Cookie` for a `__Secure-` cookie that lacks it, so an options-less delete silently no-ops on HTTPS and the loop never breaks (works on HTTP localhost, which is why dev never catches it). _Reverse if_ Auth.js gains a sanctioned way to invalidate the cookie from within a server callback.
- **Signout flows hand `?cleanup=1` to `/signin` so the SW drops user-scoped caches.** Both signout entry points (the explicit signout button and `/api/auth/recover`) redirect to `/signin?cleanup=1`. The signin page mounts a client island ([components/auth/sw-signout-cleanup.tsx](../components/auth/sw-signout-cleanup.tsx)) that posts `{ type: 'CLEAR_USER_CACHES' }` to the active service worker; the SW deletes only caches matching `pages|rsc|apis|cross-origin|others`, leaving static-asset caches intact so the next sign-in doesn't pay a cold-cache penalty. Why a sentinel param instead of always-clearing: organic landings on `/signin` (bookmarks, direct navigation, the first-ever visit) have nothing to clean and would waste a fetch on the next nav. _Any new signout entry point must set the param_ — silent drift here means a second user on the same device could see the previous user's SW-cached HTML during a network blip. _Reverse if_ we ever add multi-user features where cross-user data leakage matters more than network cost and the always-clear path becomes the simpler invariant.
- **Touch inputs use a 16px font-size floor; pinch-zoom stays enabled.** [app/globals.css](../app/globals.css) forces `:is(input, textarea, select):not([type='checkbox']):not([type='radio'])` to `font-size: 16px` under `@media (pointer: coarse)`. The selector specificity (0,0,2,1) is calibrated to beat Tailwind's `text-sm`/`text-xs` utilities (0,0,1,0); if it lost, iOS Safari would zoom on input focus. Earlier the project used `maximumScale: 1` + `userScalable: false` on the viewport to suppress that zoom, but those also disable pinch-zoom (WCAG 1.4.4 violation). The CSS floor sidesteps iOS's heuristic without locking the page. _Don't lower input font-size below 16px on mobile without re-testing iOS focus behavior, and don't reintroduce viewport-scale locks._

---

## Detailed decisions (ADR-style)

These are calls where the alternatives are genuinely worth remembering, in case the situation ever changes.

### Multi-muscle credit: weighted, not all-or-nothing

**Context.** Many exercises (deadlifts, squats, RDLs) work multiple muscle groups, but unevenly. We needed to capture "you made _some_ progress on these other muscles" without claiming a deadlift is fully a hamstring exercise.

**Decision.** Each `Exercise` has `primaryMuscles[]` and `secondaryMuscles[]`. Each set credits primary at 1.0, secondary at 0.5. The Coverage view's _recency_ (when you last touched a muscle) treats both equally — touching at all freshens it. The _volume_ count is weighted.

**Alternatives considered.**

- _All muscles equal (single `muscles[]` array)._ Simpler, but inflates volume claims. Doing only RDLs would credit your back as fully as it credits your hamstrings. Misleading.
- _Primary only, no secondary._ Lose the "I did get some shoulder work from overhead pressing" signal that motivates rest-day choices. Coverage view goes red on muscles that are actually being touched.
- _Configurable weights per exercise._ Overkill — gives users a knob they don't want, and the half-credit heuristic is good enough.

**Why it stays.** Captures real-world training honestly without requiring users to think about it.

### JWT session lifetime: 1 year

**Context.** Auth.js v5 supports both database sessions and JWT sessions. JWT sessions don't require a DB hit on every request. We had to choose a `maxAge`.

**Decision.** JWT strategy with `maxAge: 60 * 60 * 24 * 365` (1 year), `updateAge: 60 * 60 * 24` (refresh cookie at most daily on activity).

**Alternatives considered.**

- _30-day or 90-day expiry._ Standard for SaaS. But this is a fitness tracker — a user who returns from a 4-month hiatus shouldn't be greeted by a sign-in wall. Friction at exactly the wrong moment.
- _Database sessions._ Would let us invalidate centrally on demand. But adds a DB hit per request and complicates middleware (which runs Edge-side, can't hit the database).

**Why it stays.** This is a workout tracker, not a banking app. The tradeoff is: if the JWT signing key (`AUTH_SECRET`) ever leaks, every existing session is forgeable until rotation. Mitigation: rotation is a single env var change, documented in DEPLOY.md.

**Reverse if.** We add multi-user features where a compromised account can affect others, or any kind of admin/moderation surface.

### Don't store "type of day" on a WorkoutSession

**Context.** Most splits a user might bring in (their own, a coach's, a common template like PPL or Upper/Lower) have named days — "Lower 1", "Lower 2", "Upper", "Balance", "Push", "Pull", and so on. The original instinct was to add `dayFocus: string` to `WorkoutSession` to capture that label.

**Decision.** Don't. A session is a date and a list of sets. The "what kind of day was this" is implicit in which exercises you logged, and the user knows what they did.

**Alternatives considered.**

- _`dayFocus` enum._ Forces the user into a fixed taxonomy, defeats the "tool, not prescription" stance.
- _`dayFocus` free-text._ Inconsistent across sessions, hard to aggregate, easy to forget to fill in.
- _Tags._ Flexible, but no actual feature uses them. YAGNI.

**Why it stays.** The Coverage view shows the user what they've done at the muscle level — they don't need a self-applied label. Templates (added later) cover the "I want to repeat a known lineup" case without forcing taxonomy.

**Reverse if.** A clear feature need emerges that requires it (e.g. "show me all my Lower 1 sessions"). Don't add it speculatively.

### Backups: plain SQL gzip, not encrypted at rest

> **Superseded (2026-06-21)** by the "Postgres → SQLite" ADR at the end of this file. The `pg_dump`-based `backup` / `backup-loop` / `restore` machinery was removed with Postgres; the SQLite database is a single file backed up by safe copy. Kept for the reasoning trail.

**Context.** Decided against three things at once: pg_custom format, in-app encryption, in-app offsite shipping.

**Decision.**

- `pg_dump --format=plain --no-owner --no-privileges | gzip -9` to a host-mounted directory.
- Local files unencrypted.
- The user's existing offsite pipeline picks up the directory and handles encryption, transit, and long-term retention.

**Alternatives considered.**

- _Custom format (`pg_dump -Fc`)._ Smaller, parallel restore. But requires `pg_restore`, less inspectable. For our DB size, plain wins on simplicity.
- _In-app encryption (e.g. `gpg`-encrypt the dump)._ Doubles the encryption surface — now we have two keys to manage and a restore path that involves both. The user already has a working encryption setup with key escrow they trust. Don't replace working machinery.
- _In-app offsite shipping (rclone, restic, etc)._ Same argument — duplicates infrastructure the user already owns. Also adds ongoing dependency management for what should be a "drop a file in a folder" interface.

**Why it stays.** Honoring an explicit user preference. The local directory is the integration point; everything beyond it is the user's pipeline.

**Reverse if.** A user without an offsite pipeline adopts this stack. Then in-app shipping (probably restic to S3-compatible storage) becomes the right add. Encryption-at-rest of the local file would still be optional since the offsite tier handles it for the canonical copy.

### One active session per user, app-enforced not DB-enforced

> **Superseded (2026-06-21)** by "Active-session uniqueness is now DB-enforced" near the end of this file. Kept for the reasoning trail. The decision below was reversed once the audit showed the dedup hid a real cross-tab bug rather than absorbing it harmlessly.

**Context.** The app convention is "at most one `WorkoutSession` per user with `completedAt: null`." We could enforce this in the schema with a partial unique index (Postgres supports `CREATE UNIQUE INDEX ... WHERE completedAt IS NULL`).

**Decision.** Don't. Enforce in the app: `findActiveSession()` always orders by date desc and takes the first. `getOrCreateActiveSession()` is the only path that creates one; it checks first.

**Alternatives considered.**

- _Partial unique index._ Would catch races at the DB level. Two strikes against: (a) Prisma's support for partial unique indexes is limited and historically painful (`@@unique` doesn't take a `where`); (b) the failure mode under contention is a user-visible "unique constraint violation" error, which is worse than just deduping.
- _Application-level lock (advisory lock or row lock)._ Heavy machinery for a problem that's vanishingly rare in single-user practice.

**Why it stays.** The race is theoretical (one user clicking "start workout" in two tabs simultaneously). In the worst case we end up with two active sessions; `findActiveSession()` deterministically picks one and the other becomes unreachable but harmless.

**Reverse if.** We see actual evidence of duplicate active sessions in production (check the logs).

### Routines: user-authored cycles, not app-prescribed plans

**Context.** Templates capture a single workout's lineup. Users with a fixed training rotation (4-day split, push/pull/legs, etc.) wanted to express the _cycle_ — "after Lower I do Upper, then Trunk, then loop." Earlier docs said "if we ever add a recommendation feature, it grows from coverage data, not from a stored plan." A routine is a stored plan.

**Decision.** Add a `Routine` model (one per user) with an ordered list of `RoutineDay` rows that each point at an existing template. Two scheduling modes:

- **`sequence`** — self-paced cycle. A `lastCompletedPosition` cursor advances when a session started from the routine is completed via `completeActiveSession`. "Today's day" = `(lastCompletedPosition + 1) mod days.length`.
- **`weekday`** — each day is pinned to a weekday (0-6, unique per routine). Calendar drives "today's day"; no cursor.

The workout page's empty state grows a routine timeline (recent + today + upcoming) when a routine exists; without one, the existing template list + picker remains. The active-session UI is unchanged. Capped at 7 days per routine to keep the timeline UI bounded; weekday mode is naturally bounded the same way.

The framing matters: a routine is a _representation_ of the user's own cycle, not a recommendation engine. The UI says "Up next" / "Today," not "you should do." There are no streaks, adherence tracking, or nag-on-skip behaviors. Coverage remains the muscle-level signal. The user can always start an ad-hoc session or pick a different day.

**Alternatives considered.**

- _Don't build it._ The "stored plan that produces 'do this next' suggestions" framing was real tension. Considered simpler shapes — just an ordered list of templates, no cursor, no "Up next." Lighter; also less useful. The user's own framing ("the app reflects what you told it") closed the loop on the stance: representing a user-declared cycle isn't the same as the app inventing one.
- _`dayFocus` on `WorkoutSession`_ (still rejected). Sessions remain records. The cycle lives on the routine; the session just records what happened, with an optional FK back to the routine day it was started from. Decoupled state.
- _Multiple routines per user._ One routine per user is the cap. Switching routines means editing yours. Multiplicity adds active-routine selection complexity for a single-operator app; deferred.
- _Prescriptive scheduling features_ (rest-day reminders, "you missed Wednesday" callouts). Hard no — directly conflicts with the neutral-tool stance.

**Why it stays.** Templates were always plans; routines are the same kind of object scaled up to a cycle. The schema cost is small (3 models + 1 nullable FK), the cursor model is honest about how training really progresses (next-in-sequence, not calendar-shame), and the cap on size keeps the UI predictable.

**Reverse if.** Users adopt routines and find the cap too tight (rotate to weekday mode, or revisit the cap). Or the next-in-sequence model fights actual usage — e.g. people skipping arbitrary days and wanting the cursor to track which one they actually did, not just advance — in which case the cursor probably becomes a `lastCompletedDayId` rather than a position.

### Cross-method account linking by verified email

**Context.** Auth.js v5 supports Google OAuth and email magic links as separate providers. By default, signing up with one provider and later attempting the other for the same email throws `OAuthAccountNotLinked` — the user is locked out of their own account from the alternate path. Auth.js's `allowDangerousEmailAccountLinking` flag bypasses this, but the "dangerous" label exists for good reasons.

**Decision.** Set `allowDangerousEmailAccountLinking: true` on the Google provider. A user who signed up via magic link can later sign in with Google (and vice versa) without account-linking errors.

**Why this is safe here.** The "dangerous" warning targets account-takeover via _unverified_ email. The classic attack: an attacker creates an OAuth account with a fake `email_verified: true` claim using a provider that doesn't actually verify, then "links" to a victim's existing account. Neither of our providers has that hole:

- **Google** verifies email ownership before issuing OAuth tokens — `email_verified: true` from Google is real.
- **Resend magic links** require the user to click a link delivered to their inbox, so signing in via magic link proves current control of the address.

Both providers therefore prove "I currently control this email" at sign-in time. Linking them is safe because either provider already establishes the trust the other needs.

**Alternatives considered.**

- _Leave the default behavior on._ Means a user who signs in once with magic link can never use the Google button for the same address without manual intervention. Real friction; no security benefit given our verified-email-on-both-sides setup.
- _Manual linking UI._ Build a settings screen where the user explicitly links their second provider. Overengineered — the flag already produces the right behavior given our threat model.

**Why it stays.** Removes a sign-in dead-end for a self-host audience that has no incentive to attack themselves. The verified-email property of both providers is load-bearing — if either ever gets swapped for a provider that doesn't verify email, this decision flips.

**Reverse if.** A password-based signup is added (passwords + linking-by-email = the classic vulnerability), or either provider is replaced with one that doesn't gate on a verified email.

### Per-template planned sets and reps

**Context.** The app originally kept set/rep prescription as a free-text string on `Exercise` (`"3×12, 5-sec hold"`) and explicitly resisted structuring it ("No prescriptive workout ranges"). That stance held when each exercise had one canonical prescription, and templates were just ordered lists. Once routines landed and each routine day owned its own template, users started wanting per-day planning: "squats 4×6 on Lower 1, 3×10 on Lower 2." With one shared `Exercise.prescription` per exercise, there was nowhere to put that.

There was a deeper tension too: the routine editor showed no way to author the _plan_ portion of a plan. You could pick which exercises went where, but not how much you intended to do. Users were filling that in only at session-start time, in a context where they couldn't see the whole week's volume balance.

**Decision.** Add `plannedSets: Int?` and `plannedReps: Int?` to `TemplateExercise` (the junction row between a template and an exercise). Both nullable so existing rows and quick-pick flows can leave them blank. They feed the seeder:

- Set count: history > `plannedSets` > parsed `Exercise.prescription` ("3×12" → 3) > `defaultSetsPerExercise` preference
- Reps: history > `plannedReps` (only when no history exists) > null

The `Exercise.prescription` text remains and stays free-form — it's the _cross-template_ note ("ATG depth, 5s eccentric"). Per-template numbers are the _plan for this slot in this routine_.

The UI shows two small "—×—" inputs next to each exercise in the routine editor's day cards. Empty means "not planned"; the seeder falls through. A structural coverage panel underneath the days projects total weighted sets per muscle across one full cycle, comparing to the user's volume targets.

**Alternatives considered.**

- _Keep the free-text-only stance._ Means the app can never reflect "here's the volume I'm planning for this muscle." The Coverage view becomes purely retrospective; users can't sanity-check a routine before running it. We considered building the panel using the prescription's parsed `N×M` and the global `defaultSetsPerExercise` only, but that's a single shared knob — it can't express "more squats on Lower 1 than Lower 2."
- _Rep ranges (`repsLow`/`repsHigh`)._ Tempting for hypertrophy programming where 8–12 is more honest than 10. But the UX cost is real: two inputs per exercise, decisions about how to seed sets ("which end of the range?"), and we'd be inventing taxonomy the rest of the app doesn't use. A single number is closer to how users currently log (one rep field per set), and the free-text `Exercise.prescription` is still there for users who want to remind themselves of a target range.
- _Planned weight too._ No — weight is the most history-sensitive number and progressive overload is the whole point. Letting users author a target weight conflicts with "history wins" in a way sets/reps don't.

**Why it stays.** Templates were always plans; this just lets users author the numerical part of the plan they were already declaring with their exercise lineup. It doesn't touch the neutral-tool stance — the user authors the numbers, the app represents them back. The seeder's history-first ordering means once you've actually done the workout, your real numbers replace the planned ones — the plan is a starting point, not a prescription.

**Reverse if.** Users want rep _ranges_ badly enough that the single-number model gets in the way (then `plannedReps` becomes `plannedRepsLow`/`plannedRepsHigh` with an Int alias for the common case). Or — the opposite — nobody uses the per-template numbers and they sit null forever, in which case strip the columns and revert to prescription-only.

### Per-(day, exercise) note as a single free-text field

**Context.** The planned-sets/reps/seconds columns above capture the _numerical_ part of the plan. They don't capture what the user actually wrote down when working with a physical therapist or coach: tempo cues ("5-sec hold at top, 3-sec abduction press"), breathing protocols ("4-sec inhale, long controlled exhale"), progression cues ("build to 12, then 15"), or stylistic notes ("his pattern", "honor the breathing — it's doing double duty"). With only planned numerics, all of that landed on the floor. The `Exercise.prescription` field exists but is shared across every template using that exercise — wrong scope. The per-day `RoutineDay.label` is a short tag for the day as a whole — also wrong scope.

The friction was concrete: a real PT plan took 60–90 minutes to enter, and the schema captured ~65% of what the PT actually said. The missing 35% was always this kind of annotation.

**Decision.** Add one nullable `note: String?` column on `TemplateExercise`. Free text, no structure. Edited inline in the routine editor under each exercise row (collapsed by default, click-to-expand textarea, commit-on-blur — same pattern as the planned-numeric inputs). Surfaced read-only in `ExerciseInSession` so the user sees what they wrote while lifting. Empty trimmed input clears the column to null via the action-side Zod transform.

**Alternatives considered.**

- _Structured tempo / hold / breathing columns._ `tempoString String?` + `holdSeconds Int?` + `breathingPrompt String?` would make Bernadette-style protocols machine-readable. We could then drive a "5-second hold prompt" mid-set in the UI, a tempo metronome, etc. Rejected for two reasons. First, neutrality: the moment the app _renders_ a tempo cue as a prompt instead of as text the user wrote, it crosses from reflecting to coaching, and that's the bright line the project doesn't cross. Second, YAGNI: enumerating the fields is unbounded ("eccentric seconds", "concentric seconds", "pause at top", "rest between holds", "RPE target", "breathing pattern") and the failure mode of free text is recoverable — promote whatever subset matters later. Inventing the taxonomy now would lock the schema to a partial answer.
- _A shared `note` on `Exercise`, like `prescription`._ Wrong scope. The whole point of these annotations is that they're _per-day_ — the same RDL on a heavy day and a light day takes different notes. A globally-shared note would force the user to either flatten all variants into one paragraph or stop using the field.
- _Put it on `RoutineDay.description` instead._ Different feature — captures the day's overall framing ("Lower emphasis (glute drive), stack ~60 min"). Notes per exercise belong with the exercise, not buried in a day-level paragraph the user would have to scroll past.

**Why it stays.** The user types it, the app stores it verbatim, the in-session view renders it read-only. No timer cues, no metronomes, no nags. It's the smallest possible expansion that catches the long tail of PT-style annotation without re-prescribing what the user wrote.

**Reverse if.** A clear, narrow use case emerges where the app _would_ benefit from structure — most likely a mid-set timer cue based on a hold count. At that point, peel off `holdSeconds` (or similar) as a structured field while keeping `note` for everything else. Don't speculatively pre-structure.

### Prefs come from a context provider, not from props

**Context.** Both the workout page and the app shell header (cue toggle) need to read and write the same user prefs (rest-timer enabled, seconds, sound, vibrate). The initial implementation drilled a `preferences` prop into `WorkoutView` and held parallel local state in the header. The two desynced — toggling the rest-timer in the workout view didn't update the header cue toggle until the next server revalidation, because each surface had its own copy of the same data.

**Decision.** Move prefs into `PrefsContext` (`components/ui/prefs-context.tsx`), provided at the app layout level. Both surfaces consume via `usePrefs()`; the settings page editor reads from the same context. Updates flow through `updatePrefs()`, which patches local state and calls the `updateUserPreferences` server action in one call. The settings page, the workout view, and the header cue toggle all stay in sync.

**Alternatives considered.**

- _Keep prop-drilling._ The pattern that caused the bug. Across a layout/page boundary, every consumer maintains its own copy of the same prop, and there's no built-in mechanism for one consumer's update to flow to a sibling.
- _Server state only, no context._ Workable, but every toggle round-trips through `revalidatePath` before the UI reflects the change. Sluggish for a setting the user flips mid-workout.
- _A global state library (Redux, Zustand, Jotai)._ Overkill for a single shared object. Adds a dependency and a vocabulary the rest of the app doesn't use.

**Why it stays.** `PrefsContext` is intentionally the _only_ client-side context provider in the app. The rule it represents: shared _mutable_ state that crosses the layout/page boundary uses context; everything else (which is almost everything) server-renders and revalidates. If you find yourself reaching for a second provider, check whether the data really needs to be mutable across boundaries — usually a server query is enough.

**Reverse if.** A second concern develops the same shape (mutable, crosses the boundary, can't tolerate a server round-trip) and a more general pattern would be cleaner than two ad-hoc providers. Or React / Next.js evolves a primitive that makes this kind of share trivial without provider boilerplate.

### Routine sharing — anonymous public reviewers, owner disposes

**Context.** The owner wants feedback on their routine from friends or a coach, without spinning up accounts for them. The reviewers should be able to leave per-target comments, react ("good"), and propose structured suggestions: swap an exercise for a specific one / one of several / any in a category; reorder; insert; remove; suggest a new custom exercise the owner doesn't have; and quick "directional" stickers (more sets, fewer reps, bodyweight) that don't require the reviewer to pick numbers. The owner reviews everything in an in-app inbox and one-click-applies structured suggestions.

**Decision.** Add a small sharing surface: `RoutineShare` (with unguessable token + revokable), `ShareReviewer` (anonymous identity per share, keyed by an HttpOnly cookie + reviewer-chosen display name), `ShareComment` and `ShareSuggestion` (both polymorphic over routine / day / template-exercise), `ShareReaction` (toggle thumbs-up per target), and `Notification` (in-app inbox for the owner — no email, no web push yet). The public route lives at `/share/[token]` and is the only _interactive_ unauthenticated app route besides `/signin`, `/verify-request`, and the static `/offline` fallback; it's bypassed in middleware via `PUBLIC_PATHS`. Public server actions in `lib/actions.ts` skip `requireUser()` and authenticate via the share token + reviewer cookie instead.

**Why it doesn't violate "the app is neutral".** The app still doesn't author plans or coach the user. It represents what the user told it; the addition is that the user can now invite _other people_ to tell it things too, and the user remains the only one who actually mutates their routine. Reviewer suggestions are proposals — they show up on the share page and in the owner's inbox; only the owner can accept them (via one-click apply for structured edits, or by hand-editing for advisory stickers). No "the app suggested X" channel was opened.

**Anonymous reviewers + cookie identity.** Reviewers don't have accounts. On first visit they enter a display name; the server mints a `reviewerKey` random token, stores it on `ShareReviewer`, and sets it as an HttpOnly cookie scoped to `/share/<token>`. The cookie is the auth for subsequent comment/suggestion/reaction posts on that share. Clearing cookies = new identity. The trade-offs are deliberate: link secrecy is the only access control, and abuse is bounded by the owner's ability to revoke a link. This is a friend-review tool, not a multi-user system, and we explicitly chose this over an email-gated magic-link flow to keep onboarding to zero friction (see the original conversation; "build fast" stance).

**Notifications.** In-app only — a bell icon in the header with an unread count, plus a `/notifications` inbox page. No email, no PWA web push. Reactions intentionally generate quieter notifications than comments/suggestions (the bell counter is the real signal; we don't want a thumbs-up storm to crowd out actual feedback). Best-effort delivery: a failure in `notifyRoutineOwner` swallows the error and lets the parent action succeed — better to lose a notification than to break a reviewer's comment because the owner's notification table hiccuped.

**Per-template `plannedWeight`.** Added alongside the existing `plannedSets`/`plannedReps`/`plannedSeconds`. Same neutral framing as those: the user (or accepted reviewer suggestion) authors a hint; the session-seeding logic uses history first and falls back to the planned values. We considered keeping the routine free of weight planning (the original per-template-numbers decision deliberately excluded weight) but accepted that sticker suggestions like "bodyweight" need somewhere to land. The reviewer never picks a number — they tap a directional sticker; the owner fills in the concrete value when accepting.

**One-click apply only on routine-day templates we own.** Existing routine-day templates always own their template (see `createRoutineFromDraft` and the comment on `swapInRoutineTemplate`), so applying structured edits is a direct template mutation. We considered auto-forking a built-in template if a routine ever ended up pointed at one, but the invariant holds today and we'd rather discover it broken than carry the fork-on-write code path. If that invariant ever fails, `applyShareSwap`/`Remove`/`Reorder`/`Insert` will refuse with the normal "Routine day not found" error and the owner can resolve manually.

**Alternatives considered.**

- _Authenticated reviewers (sign-in required)._ Cleaner identity, supports notifying reviewers back when their suggestion is accepted, no anonymous-impersonation concerns. Rejected because the friction kills the use case — the owner wants to text a friend a link and have them just _look_, not create a Google account or wait for a magic link. The same trade-off as Auth.js's `allowDangerousEmailAccountLinking: true` decision: this is a self-hosted app for the operator's social circle, not a public service.
- _Email-gated magic link._ Middle-ground friction. Adds a Resend send and a verification flow per reviewer for what is essentially "leave a comment on a Google Doc." Rejected.
- _Free-text suggestions only._ Cheapest implementation. Rejected because the whole point of the feature was structured swaps (1:1, multi-pick, category), where the owner can one-click apply — comments alone would force the owner to hand-translate every suggestion into routine edits.
- _Auto-apply suggestions instead of owner accept._ Would let reviewers "vote in" their own changes. Rejected on the philosophical stance: the owner authors the routine; reviewers propose. Auto-apply would also turn link compromise into a routine-corruption incident.
- _Web push notifications._ Cheap once Serwist is wired (which it is), but introduces VAPID key management and a subscription endpoint we don't have. Deferred — the bell counter covers 95% of the use case, and we can layer push on later without schema changes if the owner finds the bell insufficient.

**Why it stays.** Friend review is the natural extension of "let me show someone my plan." Doing it without spinning up auth keeps the self-hosted single-operator stance intact while opening the door for collaborative input. The structured-suggestion-with-owner-accept pattern preserves the philosophical line ("represent what the user told us") even as the input surface widens.

**Reverse if.** Abuse via shared links becomes a real problem (move to email-gated auth). Or in-app notifications turn out to be insufficient and the owner misses important feedback (add web push). Or the structured-suggestion taxonomy ossifies in ways that block useful suggestion kinds — at which point the `payload Json` column is a real asset, since we can iterate suggestion kinds without schema changes.

### Service-worker updates use prompt-and-reload, not `skipWaiting`

**Context.** Serwist's defaults — `skipWaiting: true`, `clientsClaim: true` — make a newly-installed service worker take over immediately and claim every open page. The running JS in those pages is still the _old_ version. For a static-asset reference that's usually fine; for anything that depends on a route's RSC payload or an emitted-chunk URL, the freshly-claiming SW can serve assets the running code wasn't compiled against, producing the well-documented "version skew" reload loop. The trigger that surfaced this for us is more concrete: a user mid-set is typing reps into an input that commits on blur. A silent reload while they're typing loses the in-flight value, and there's no warning.

**Decision.** Drop `skipWaiting`/`clientsClaim` from the Serwist constructor (both `false`). New SWs park in `waiting`. A client island ([components/ui/sw-update-prompt.tsx](../components/ui/sw-update-prompt.tsx)) mounted in the root layout watches for `updatefound` + `statechange === 'installed'`, only surfacing the prompt when an existing controller is present (so the first-ever install — when there's nothing to "update from" — doesn't pop a toast). On accept, it posts `{ type: 'SKIP_WAITING' }`; the SW's message handler ([app/sw.ts](../app/sw.ts)) calls `self.skipWaiting()`, the browser fires `controllerchange`, and the prompt's `controllerchange` listener reloads — same listener catches reloads triggered from sibling tabs so all open tabs stay in version-sync.

**Alternatives considered.**

- _Keep `skipWaiting: true`._ The reported "auto-update like other PWAs" path. Trades the version-skew/typing-loss problem in for zero-touch updates. Wrong tradeoff for this app — set commits are the high-value mid-workout action and "lose what I just typed" is the worst failure mode.
- _Auto-reload silently (post `SKIP_WAITING` on detect, no prompt)._ Avoids the toast but still kills the active input. Same failure mode as `skipWaiting: true`, just gated on the page being open long enough to notice.
- _`navigator.serviceWorker.ready.then(reg => reg.update())` polling._ Orthogonal — that triggers the install check, not the activation step. Useful in conjunction if we ever want long-lived tabs to discover updates without a reload, but doesn't address the version-skew root cause.
- _Stop precaching JS chunks entirely (NetworkOnly for `_next/static`)._ Solves version-skew structurally by always going to the network for code, at the cost of the offline-after-cold-cache story. Too much capability lost for a problem the prompt-and-reload pattern already handles.

**Why it stays.** Prompt-and-reload is the established PWA pattern for apps with consequential in-flight UI state, and this app qualifies — the entire workout-tracking surface is a series of inputs the user expects to keep. The prompt is small, dismissable, and re-surfaces on the next page load if dismissed; the cost of "user picks the moment" is essentially zero, and the upside is no surprise reloads.

**Reverse if.** The app loses its commit-on-blur input pattern (everything writes immediately, no in-flight state to lose), _and_ update delays become a real friction point (users staying on a tab long enough that they need newer behavior). Or Serwist evolves an option that handles version-skew atomically — at which point delete the prompt and lean on the framework.

### Offline fallback is precached and public

**Context.** The service worker (`app/sw.ts`) declares an offline fallback for document navigations. Serwist resolves it via `matchPrecache('/offline')`, which returns a response **only if `/offline` is in the precache manifest**. But `@serwist/next` precaches just `_next/static/*` and `public/*` — it never precaches rendered routes. So out of the box `matchPrecache('/offline')` was always `undefined`, the fallback never fired, and an offline navigation to an uncached page showed the browser's error screen — `app/offline/page.tsx` was dead code. Compounding it: `/offline` was auth-gated by middleware, and the SW typically installs while the user sits signed-out on `/signin`, so the install-time fetch of `/offline` would have 302'd to sign-in and precached the **sign-in HTML** as the offline page.

**Decision.** Two paired changes. (1) Inject `/offline` into the precache manifest via `additionalPrecacheEntries` in `next.config.mjs`. The revision is a per-build value (`Date.now()` at config load), not a constant: `/offline` is a rendered route whose HTML embeds this build's hashed asset URLs, and Serwist evicts precache entries dropped from the manifest on activate — a constant revision would pin a stale offline page pointing at chunks the new build already removed, rendering unstyled when actually served. A fresh revision per build keeps the fallback in lockstep with the static precache. (2) Add `/offline` to `PUBLIC_PATHS` in `middleware.ts` so the install-time fetch resolves to the real offline page, signed-out or in. `/offline` uses the root layout (no `auth()` call, no `(app)` shell), so it renders standalone.

**Alternatives considered.**

- _Exclude `/offline` from the middleware matcher instead of `PUBLIC_PATHS`._ Equivalent for the redirect, but `PUBLIC_PATHS` keeps middleware running so `req.auth` is still populated, matching how `/share/` is handled. One consistent mechanism beats two.
- _Constant revision (e.g. `'1'`)._ Simpler, but goes stale against per-build chunk hashes — the failure is a silently unstyled offline page, exactly when the user can least afford confusion. The per-build re-fetch it costs is one small HTML request on an SW update that's already downloading a changed manifest.
- _A separate hand-authored static HTML file instead of a Next route._ Sidesteps the precache-a-route problem, but forks the offline page's styling from the app's design tokens and loses the `OfflineAutoReload` island. Not worth the divergence.

**Why it stays.** Offline is a normal condition for a gym PWA, not an exception. The fallback is the difference between "browser error page" and "you're offline, cached pages still work" when the network drops mid-session.

**Reverse if.** Serwist's `@serwist/next` ever precaches fallback routes itself (delete the `additionalPrecacheEntries` entry), or the offline page is replaced by a static asset already covered by `globPublicPatterns` (drop the `PUBLIC_PATHS` entry too).

### Exercise pools: "pick X of N" on the routine-day template

**Context.** The user wanted to work out from a rotating pool of exercises — define a group of N candidates on a routine day, and have only X of them be part of any given session, chosen fresh each time so they can rotate by recency. They also wanted the recency signal (last-done date) and a usage count surfaced so a rarely-used exercise can be pruned from the pool.

**Decision.** A `TemplatePool` model attached to the **template** (not the `RoutineDay`, not the `WorkoutSession`). Members are `TemplateExercise` rows with a non-null `poolId`. The pool carries `pickCount` (X). At session start, `startFromRoutineDay` takes `poolPicks` — the user's chosen members per pool — and seeds only those. Selection is **manual, recency-assisted**: the pool-pick dialog shows each member's last-done date and trailing-year session count (`getExerciseUsageStats`) and lets the user pick; the app does not auto-select. Pools are created and tuned in **both** editors through the shared `DayCard` affordances — by grouping existing slots (the `Layers` affordance) or via the exercise picker's "Add as pool" action — with `pickCount` adjustable on the pool in the day's Pools panel and per-member removal; new pools default to `pickCount` 1. In the live editor every change is its own server action; in the draft (from-scratch) editor pools live in local state alongside the rest of the draft and persist in one shot through `createRoutineFromDraft`, which carries a per-day `pools` list that `freshTemplateForUser` groups after creating the day's exercises.

**Coverage treatment.** Structural (planned) coverage and the routine editor's time estimate weight each pooled member by `pickCount / memberCount` — a "do 1 of 5" pool is estimated at one member's worth, not five (`computeRoutineVolumes` / `poolPickWeights` in `lib/coverage.ts`). That's the expected value: each member is equally likely to be the one picked. Recorded coverage (`getWeeklyVolume`, `getCoverageData`) is unaffected — it reads logged `SetLog`s, which already contain only the members actually done, so it's exact. Without the weighting a pooled day over-reports volume and time by the member-to-pick ratio; anything that touches structural coverage should preserve it.

**Alternatives considered.**

- _Pool on `RoutineDay` directly, or as a standalone reusable entity._ A routine day already owns its template 1:1, and `startFromRoutineDay`/seeding already walk the template's `TemplateExercise` rows in `position` order. Hanging pools off the template means the existing seed path needed only a "skip unpicked pool members" line — no parallel structure. A standalone reusable pool ("Push accessories" referenced by several days) is more flexible but adds a sharing/ownership surface the single-operator app doesn't need yet. Reverse if reusable pools become a real ask.
- _Two position spaces (pool gets its own `position`, members ordered within)._ Cleaner conceptually but forces every read path to merge two ordered lists. Rejected for a single `TemplateExercise.position` space with an app-enforced "pool members are contiguous" invariant (`gatherPoolMembers` + `normalizeTemplatePositions`). Contiguity is cosmetic — `startFromRoutineDay` filters by `poolId` regardless — so the invariant degrading (e.g. a share-apply path that doesn't re-normalize) is a display glitch the next pool-aware action heals, not a correctness bug.
- _Auto-pick the X least-recently-done members._ Tempting and low-friction, but it crosses the line the app deliberately holds (see "the app reflects, it doesn't coach" — no streaks, no adherence nags, no prescriptive ranges). Auto-picking is the app making a training decision. The recency/count hints give the user everything they need to decide; they pull the trigger. Reverse if users explicitly ask for an "auto-rotate" convenience — it'd be a per-pool opt-in, not the default.
- _Pool editing in draft mode (the from-scratch routine builder)._ Initially deferred — supporting pools there meant draft-shaped pool state plus an extended create schema, and pools read as a "tune an existing routine" feature the live editor already covered, so draft users were told to save first and add pools after. **Adopted later** (the reversal condition above): grouping exercises into a pool while first assembling the routine turned out to be a natural moment, and the gap was jarring because the live editor's "Add as pool" button was conspicuously absent from the otherwise-identical draft picker. Draft days gained `pools` + per-exercise `poolId` in local state, kept coherent by `normalizeDraftDayPools` (the client mirror of the server's `reconcilePoolAfterMemberLoss`); `createRoutineFromDraft` grew an optional per-day `pools` list that `freshTemplateForUser` re-validates and persists.

**Why it stays.** Pools are the structural expression of "I have five accessory movements and do two a session" — a real training pattern the app previously couldn't represent without the user hand-swapping every time. Attaching to the template kept the blast radius small. Manual-pick-with-signal keeps the neutral-tool stance intact: the app shows recency and frequency, the user rotates.

**Reverse if.** Reusable cross-day pools become a real need (promote `TemplatePool` to a standalone owned entity). Or the manual pick at session start feels like friction and users want an auto-rotate option (add it as an opt-in, don't make it the default).

### Expected errors travel as action results, not thrown messages

**Context.** The original convention threw expected user-facing failures as `Error` with stable message prefixes, matched against an `EXPECTED_MESSAGES` list in `lib/observability.ts` for log classification; clients rendered `err.message` inline or let it bubble to an `error.tsx` boundary. This worked in `next dev` and silently broke in production: Next.js redacts the `message` of any error thrown from a server action or server component in prod builds, so every carefully written message arrived as "An error occurred in the Server Components render" plus a digest. The `(app)/error.tsx` "Session expired" branch (sniffing `error.message` for `unauthorized`) was dead code in prod for the same reason. The prefix list had also drifted — roughly a dozen thrown messages weren't on it (logging as bugs) and several entries matched nothing.

**Decision.** Expected failures travel in the action's _return value_, which Next serializes verbatim:

- Action bodies throw `ExpectedError` (`lib/action-result.ts`) — the throw site stays a one-liner and transactions still roll back.
- `withLogging` is the single conversion point: it catches `ExpectedError`, logs `action.rejected` at warn with a `reason` field (no stack), and returns `{ ok: false, error: message }`. Success becomes `{ ok: true, data }` (`ActionResult<T>`). `ZodError` is treated the same but surfaces a generic "Invalid input" string — a Zod failure is a malformed payload (client bug or stale tab), not a user mistake.
- Anything else thrown is a bug: logged `action.failed` at error level with the stack and **rethrown**, so it still reaches the nearest `error.tsx` boundary. Prod redaction is fine there — there's nothing useful to tell the user about a null deref beyond the digest.
- `requireUser()` no longer throws `'Unauthorized'`; it calls `redirect('/signin')`. A dead session mid-action has no message worth rendering — bouncing to sign-in _is_ the UX. `withLogging` rethrows Next's control-flow errors (`unstable_rethrow`) before any logging or metrics so the redirect propagates untouched.
- `EXPECTED_MESSAGES` and `EXPECTED_ERROR_NAMES` are deleted; classification is type-based, so there is no list to drift. An ESLint `no-restricted-syntax` rule on `lib/actions.ts` rejects plain `throw new Error(...)` to keep the convention from regressing.

**Alternatives considered.**

- _Smuggling the message through `error.digest`_ (Next preserves pre-set digests to the client). Survives prod, but relies on undocumented pass-through behavior, abuses a field meant for log correlation, and keeps the "catch and string-match" client pattern. Rejected.
- _Converting each throw site to an early `return { ok: false, ... }`._ Loses transaction-rollback-by-throw inside `db.$transaction` callbacks and turns one-line guards into plumbing through every helper. The throw-then-convert design keeps the bodies unchanged.

**Consequences.** Client call sites check `res.ok` instead of catching — `catch` blocks around action calls now only see genuine bugs. Sites that ignore an action's result also ignore its expected failures (no boundary fallback anymore); Package 2 of the audit (client action discipline) owns making every call site surface `{ ok: false }`. When a transition should still crash to the boundary on a bug, `await` the action inside `startTransition(async () => ...)` — discarding the promise (`void action()`) swallows the rejection.

**Reverse if.** Next.js ever ships a sanctioned way to mark a server-action error as safe-to-serialize (at which point the throw-based convention could return), or actions stop being the sole mutation surface.

### Client action calls go through `useAction`, which recovers in place instead of crashing to the boundary

**Context.** Package 1 made expected failures return `{ ok: false, error }`, but the client side was inconsistent about consuming that contract. Most handlers used the statement form `startTransition(() => { action({...}) })`: React 19 only entangles a transition with awaited work, so `isPending` flipped back almost immediately and the `disabled={isPending}` guards never engaged, and a rejected action became an unhandled promise rejection — no message, no boundary. Expected failures (`'You already have a workout in progress'` from a second tab, a duplicate custom-exercise name) silently vanished; optimistic pref toggles never rolled back; Enter-key submits bypassed the disabled button and filed duplicates; a dozen `.catch(() => {})` swallows hid edits that didn't stick. Thirty-odd call sites each hand-rolled some subset of transition + try/catch.

**Decision.** One hook, `useAction` (`components/ui/use-action.tsx`), is the client-side driver for the `ActionResult` contract. `run(action, { onSuccess, onError })` awaits the action inside a `useTransition` (so `isPending` spans the real request), routes an expected `{ ok: false }` to `error` (render it where the user acted — the `ActionError` banner, or an inline line), and runs `onSuccess`/`onError` for success-only work and optimistic rollback. The deliberate departure from Package 1's guidance: **a rejected promise — offline, or a server-side bug `withLogging` already logged and rethrew — is caught and surfaced inline, _not_ routed to the `error.tsx` boundary.** Crashing the whole page to a full-screen error is the wrong response to one failed mutation in an offline-capable gym PWA: offline is a _normal_ condition there, not an exception, and the user shouldn't lose their in-progress workout because a set log didn't reach the server. `navigator.onLine === false` tailors the message ("you're offline"); otherwise it's a generic retry line. Render-time bugs still reach the boundary; only _action_ rejections are caught.

Forms that must await-and-decide for themselves keep their own state and do **not** use the hook: close-on-success-only dialogs (`SaveTemplateDialog`, the exercise picker's custom-add tab) call the action directly, read `res.ok`, and preserve the user's input on failure — they need the result in hand to decide whether to close. `useAction` is for the fire-and-surface handlers, which is most of them.

**Alternatives considered.**

- _Keep routing rejections to the `error.tsx` boundary (Package 1's stance)._ Correct for a desktop CRUD app; wrong for a PWA used offline in a gym. A failed set log would blow away the workout view. Rejected for granular mutations.
- _Sniff `error.digest` to send genuine server bugs to the boundary while handling offline inline._ Distinguishes the two cases, but couples to undocumented Next internals — the same "match on error internals" fragility Package 1 deleted (`EXPECTED_MESSAGES`). The friendly inline message is honest for both cases, and server bugs are already logged server-side with a stack, so nothing is lost by not crashing. Rejected.

**Consequences.** ~30 call sites converge on one pattern instead of 30 hand-rolled try/catches. The `error.tsx` boundaries now catch render-time crashes, effectively never action rejections — `useReportError` still ships those. Optimistic patterns keep their feel but become honest on failure: `PrefsContext` snapshots and rolls back a failed toggle, `SetRow`'s green check still flashes but a failure now raises the workout view's banner. This supersedes the previous ADR's "`await` inside the transition so a bug still reaches the boundary" note for the client-call layer.

**Reverse if.** The app grows a surface where a failed mutation genuinely _should_ halt the page (a destructive multi-step flow with no safe partial state), in which case `run` would need an opt-in `escalate` that rethrows — add it then, not preemptively.

### "What calendar day is it" resolves in the user's timezone, fed from the browser via a cookie

**Context.** Every "what day is it" question — which routine day is _today_ in weekday mode, how many days since a muscle was last worked, the recency labels — was answered with the server's local time. In the documented Docker deployment that's UTC, so for a US user "today" flipped to tomorrow at 4–8pm local: the weekday picker advanced early, and coverage recency tiers (fresh/recent/stale) shifted with the time of day. The server cannot know the user's calendar day without their timezone, and the authoritative source for that is the browser.

**Decision.** The browser writes its detected IANA zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) into a `tz` cookie via a tiny client component (`components/ui/timezone-sync.tsx`) mounted in the app layout; it `router.refresh()`es when the value is new or changed so server-rendered day math reflects the right zone immediately. The server reads and validates it (`lib/timezone.ts#getRequestTimeZone`, falling back to UTC) and feeds it to the only two server-side day consumers: the routine weekday picker (`pickTodaysRoutineDay`/`pickUpcomingRoutineDays`, via `localWeekday`) and coverage recency (`daysSince`/`relativeDay`, via `daysBetween`'s optional `timeZone`). The "Today" slot is labelled with the resolved calendar day ("Saturday, Jun 21"), computed server-side so SSR and hydration agree. **Client components that show recency (`relativeDay` in the workout view, picker, pool dialog) keep using browser-local — there the runtime zone _is_ the user's, so passing the cookie would be redundant.** `daysBetween` was also fixed to count calendar-day boundaries (truncate to local midnight) rather than elapsed 24-hour blocks, so a 9pm workout reads as "today" until the next local midnight regardless of zone.

**Attribution.** A session's day comes from `WorkoutSession.date`, stamped at _start_, and nothing re-derives it from `completedAt`. So a session that starts 11pm Mon and finishes 12:30am Tue counts as Monday; start 11pm Tue → finish 12:30am Wed counts as Tuesday — distinct local days from the two start instants, no double-count, no skipped day. The volume window stays a rolling 7×24h instant comparison (zone-independent by construction) and remains coherent with start-instant attribution.

**Alternatives considered.**

- _A `timeZone` column on `UserPreference`, auto-detected and persisted._ More idiomatic for the prefs-heavy parts of this app, and durable across browsers. But the source of truth is fundamentally the browser's detected zone in both designs — the column would just cache it in the DB instead of a cookie — and it costs a schema column, a settings surface, a write-on-detect action, and the awkward "auto-sync vs. manual override" tension. Not worth it for a single-user self-hosted app where the cookie converges identically. _Reverse if_ the app grows multi-device users who want a server-set zone independent of whichever browser they're on, or a deliberate manual override (travel).
- _Client offset header / passing `getTimezoneOffset()`._ A numeric offset can't name the zone (DST, half-hour zones) and would have to ride on every request anyway. The IANA string in a cookie is strictly more capable.
- _Defer all day math to the client._ Would eliminate the server zone need entirely, but the routine timeline is server-shaped (page pre-selects today's day) and moving selection to the client is a bigger refactor than the cookie. The label _is_ effectively client-sourced (the cookie is the browser's report); we just resolve it server-side to avoid a hydration flash.

**Reverse if.** See the per-alternative triggers above; the most likely is genuine multi-device use wanting a persisted, override-able zone — at which point promote the cookie to a `UserPreference` column and keep `getRequestTimeZone` as the single read point.

### Postgres → SQLite (single-user self-hosted)

**Context.** The app is deployed by one operator on their own hardware and will realistically have a single user for the foreseeable future. The Postgres deployment carried a second container (`postgres:16-alpine`), a `pg_dump` backup service in a third container, an `internal` network, a `POSTGRES_*` credential trio, and a password-rotation procedure — a lot of moving parts for a single-writer workload. The goal was to shrink the deployable package ahead of the first real deployment.

**Decision.** Move to SQLite, accessed through Prisma 7's `@prisma/adapter-libsql` driver adapter against a `file:` database on a Docker volume. Compose collapses to a single `app` service plus an `app-data` volume; the `db` and `backup` services, the `internal` network, and all `POSTGRES_*` / `BACKUP_*` env are gone. `DATABASE_URL` becomes a `file:` URL (`file:./prisma/dev.db` in dev, `file:/app/data/workout.db` in compose).

**Alternatives considered.**

- _Keep Postgres._ The most capable option, and the right call the moment a second writer or horizontal scaling appears. But for one user it's pure operational overhead — a whole RDBMS, its container, its backup tooling, and a credential to rotate, to serve a workload SQLite handles in a single file.
- _`better-sqlite3` instead of libsql._ The more "standard" embedded binding and a touch lighter. Rejected because its prebuilds are Node-ABI-locked and glibc-only, so on a current Node and on Alpine/musl it falls back to a native compile needing a C toolchain in the image. `libsql` ships NAPI prebuilds (ABI-stable, glibc **and** musl), so nothing compiles anywhere — the Dockerfile needed no build tools, which is more in keeping with "simplify." libsql also leaves a door open to remote/Turso later. _Reverse if_ libsql's footprint or fork-of-SQLite status becomes a problem; the swap is isolated to `lib/db.ts` + `prisma/seed.ts`.
- _A relation table for the muscle/equipment lists instead of JSON._ More correct relationally and queryable in SQL, but overkill: nothing filters those lists in the database (all matching is in JS), so a `String` column holding a JSON array, (de)serialized at the data-access boundary (`lib/scalar-list.ts`), was the smaller change. _Reverse if_ a feature needs to filter exercises by muscle/equipment in the query itself.

**Consequences.**

- **Scalar lists became JSON strings.** SQLite has no array type; `Exercise.equipment` / `primaryMuscles` / `secondaryMuscles` are `String` columns of JSON, converted at the boundary. See prisma/CLAUDE.md → "SQLite gotchas."
- **`createMany({ skipDuplicates: true })` is gone** (unsupported on SQLite). The three race-safe idempotent inserts moved to `upsert` with a no-op update / catching P2002.
- **Backups are a file copy, not a service.** There is no automated backup anymore — an explicit choice for this single-user deploy. The DB is one file; back it up via the SQLite backup API or while the app is stopped, never a plain `cp` of a live WAL database. The operator's offsite pipeline still owns encryption + retention. This supersedes the "Backups: plain SQL gzip" ADR above.
- **Seeding is manual.** Prisma 7's `migrate dev` / `reset` don't auto-run the seed; first boot needs `npm run db:seed` (dev) or `docker compose exec app node prisma/seed.js` (compose) to load the built-in exercises.
- **Single writer.** SQLite serializes writes — invisible at one user, and the hard limit that defines the reverse-if below. The partial unique indexes (active session, live-custom name) and the NULL-distinct uniques all carry over unchanged; SQLite supports both.
- **Smaller footprint.** One Node process instead of Node + Postgres; backups are a file; one fewer credential and no rotation dance.

**Reverse if.** A second concurrent writer appears (multi-user, or a background writer), write contention shows up, or the deployment needs more than one app replica. Going back is bounded: swap the adapter in `lib/db.ts` / `seed.ts`, return the three list columns to native arrays (dropping the `scalar-list` boundary), reinstate `skipDuplicates`, and restore a `db` service + dump-based backups. The schema and app logic are otherwise provider-agnostic.

### Active-session uniqueness is now DB-enforced (reverses "app-enforced not DB-enforced" above)

**Context.** The earlier decision (“One active session per user, app-enforced not DB-enforced”) declined a partial unique index, reasoning that (a) Prisma’s partial-unique support is awkward and (b) the failure mode under contention — a user-visible constraint-violation error — is worse than just deduping with `findActiveSession()` ordered by date. The pre-testing audit (package 5) re-examined this and found the “just dedupe, it’s harmless” premise doesn’t hold. Two tabs (or PWA + browser) racing “start workout” create two active sessions; `findActiveSession` returns the most recent by date, so the other becomes invisible, and `startFromTemplate`/`startFromRoutineDay` then refuse to start anything (“you already have a workout in progress”) pointing at a session the user can’t see. The dedup hid the bug rather than resolving it. The ADR’s own “reverse if” trigger — evidence the dedup isn’t harmless — was met.

**Decision.** Add a partial unique index `WHERE "completedAt" IS NULL` on `WorkoutSession(userId)`. Both original objections dissolve under the implementation the audit specified:

- _(a) Prisma awkwardness_ — sidestepped by writing the index as raw SQL hand-edited into the init migration (`Exercise(ownerId, name)` got the same treatment for soft-deleted customs). Prisma never has to express the `WHERE`; it just has to not clobber it on regen, which the prisma/CLAUDE.md recipe now guards with a loud manual step.
- _(b) ugly user-facing error_ — the three find-then-create paths (`getOrCreateActiveSession`, `startFromTemplate`, `startFromRoutineDay`) catch the P2002 via `isUniqueViolation` and convert it: the explicit-start paths throw the same friendly “already have a workout in progress” `ExpectedError` they already throw on the pre-check, and `getOrCreateActiveSession` adopts the winner’s session (idempotent get-or-create). No raw constraint violation ever reaches the client.

The app-level pre-check and `findActiveSession`’s date ordering both stay — the pre-check gives the friendly message on the common (non-racing) path, and the ordering keeps reads deterministic if a legacy duplicate somehow predates the index. The index is the backstop the pre-check structurally can’t be (cross-process).

**Why it stays.** The fix is cheap (one raw index + a shared catch helper) and closes a bug a first tester would plausibly hit, with no UX regression — the racing tab sees exactly the message it would have seen anyway. The same raw-partial-index machinery also fixes the soft-deleted-custom-name collision, so the maintenance cost (the manual regen step) is shared across two fixes.

**Reverse if.** Prisma gains first-class partial-unique support (then the index moves into the schema and the manual regen step goes away), or the single-active-session model itself changes (e.g. supporting parallel draft sessions), which would be a much larger rethink.

### Small schema-integrity backstops added alongside the active-session index

Two lower-stakes calls from the same audit package, recorded so they aren’t re-litigated:

- **`SetLog (sessionId, exerciseId, setNumber)` unique + `addSet` retry, rather than accepting the duplicate.** A double-fire `addSet` used to mint two rows with the same `setNumber` (self-healing on the next renumber, but confusing). The contiguity invariant was already documented as app-enforced; promoting it to a DB unique was in-theme, and `addSet` now retries against the new max on P2002 so each tap reliably appends a contiguous set. The renumber paths are safe because they only ever shift numbers downward in ascending order. The sibling case — duplicate `position` values from `addExercisesToActiveSession` — was _accepted_, not constrained: positions are display-order, non-unique by design, and self-heal on the next reorder. _Reverse if_ the retry proves hot enough to matter (it won't at single-user scale).
- **Idempotent cleanup over delete-by-id for emptied sessions and toggled reactions.** `removeSet`/`removeExerciseFromActiveSession`/`completeActiveSession` use `deleteMany` for the empty-session cleanup (a concurrent cleanup is a no-op, not a P2025), and `toggleShareReaction` uses `createMany({ skipDuplicates })` + `deleteMany` so a double-tap can't throw P2002/P2025 — with the owner notified only when a row was actually inserted. A reviewer who deliberately un-reacts then re-reacts will re-notify; that's accepted (reactions are the intentionally quiet notification tier and the share link is revocable) rather than persisting per-(reviewer, target) notification history across un-reacts.

### Reverse-proxy trust: host-check for CSRF, rightmost-public hop for client IP

**Context.** Two reverse-proxy assumptions surfaced in the pre-testing audit (package 7). (1) `next.config.mjs` pinned `experimental.serverActions.allowedOrigins: ['localhost:3000']` — a placeholder that never matched a real request, since `allowedOrigins` is compared against the browser `Origin` (the public host), not the upstream `Host`. (2) `getClientIp()` keyed rate limits off the _leftmost_ `X-Forwarded-For` entry, which is whatever the client put on the wire (proxies append the real source _after_ it). An attacker could rotate the leftmost value to mint a fresh per-IP bucket per request, defeating `magicLinkPerIp` (burn Resend quota across arbitrary inboxes) and `clientErrorPerIp` (log flooding).

**Decision.**

- **No `allowedOrigins`; rely on Next's built-in host check.** Next compares the `Origin` host to `X-Forwarded-Host` (else `Host`) and only consults `allowedOrigins` on a mismatch. The operator requirement is therefore "the proxy must forward the real host" — Caddy sets `X-Forwarded-Host` automatically; nginx needs `proxy_set_header X-Forwarded-Host $host`. Driving the value from `AUTH_URL` was rejected: `output: 'standalone'` serializes `next.config` into the build (`__NEXT_PRIVATE_STANDALONE_CONFIG`, re-read at boot, never re-evaluated), and the Docker image builds with no `AUTH_URL` present — so any `process.env` read there bakes an empty value into the image permanently. A domain-agnostic build that leans on the host check is the only thing consistent with build-once-configure-by-env.
- **Client IP = rightmost _public_ `X-Forwarded-For` hop.** `getClientIp()` walks the header right-to-left, skips hops on private/loopback/link-local ranges (our own proxy infra — every proxy reaches the app over a private network with `:3000` firewalled), and returns the first public address. Falls back to `X-Real-IP`, then a shared `unknown` bucket. The returned value is always one a trusted proxy wrote, so it can't be rotated by the client. Trusting "any private address is infrastructure" rather than a configured hop-count/IP-list keeps it zero-config across the documented topologies (same-host, cross-server edge, and a tunnel like Pangolin/newt in front of Caddy) — at the cost that a multi-hop chain must be configured to _preserve_ the real client IP rather than overwrite it (CADDY.md, "A proxy in front of Caddy").

**Why it stays.** Both are the minimal correct fix and need no per-deploy config: the host check is domain-agnostic, and private-range trust covers every proxy the deployment model allows (it can only reach the app over a private network). The security property — an attacker can't forge either the CSRF host or the rate-limit key — holds without the operator tuning anything, as long as `:3000` stays firewalled to the proxy, which CADDY.md already requires for unrelated reasons.

**Reverse if.** A future deployment legitimately puts a _public-IP_ proxy in the hop chain (then private-range trust mis-identifies it and `getClientIp` needs a configurable trusted set), or Next changes how Server Actions derive the trusted host.
