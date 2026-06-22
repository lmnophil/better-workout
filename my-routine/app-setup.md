# Building This Routine in the App

A click-by-click guide to entering the plan from [`routine-guide.md`](./routine-guide.md) into the
app. Labels below match the current UI; since you built it, you'll recognize anything worded
slightly differently.

**Fastest way to find any exercise: use the picker's search box and type the exact name** from the
tables here. The module column is just there if you'd rather filter by module.

---

## 0. Before you start — a few facts about the model

- **You get exactly one routine.** This builds it. (A second one errors out — you edit the one you
  have.)
- **Max 7 days.** You're using 4.
- **Draft vs. Live.** With no routine yet, everything is local — nothing saves until you press
  **Save routine**. After that you're in *Live* mode and every edit persists immediately (no save
  button). **Pools can only be created in Live mode**, so they're the last step.
- **Per-exercise you set sets × reps (and an optional note).** You do *not* set weights here — you
  pick weight during the workout, and the app shows "last time" so you just beat/match it.
- **Time-based moves use seconds, not reps** (Hollow hold, Side plank, Single-leg balance hold).
- **A day is a full session — do *every* exercise in it.** The only thing you choose between is a
  **pool**: a rotating slot with 2–3 options where you do *one* (the app asks at session start and
  suggests the least-recently-done). The "top-3 keepers" in the guide are only the time-crunch
  fallback, not a normal subset.
- **The app orders each day by module** — activation/prep → barbell → accessories → thoracic/balance
  — and seeds the session in that order. Within a module it's the order you add them. You can still
  *perform* in any order during the session; the layout is the default, not a rule.

---

## 1. Create the routine (draft)

1. Go to **`/routine`**. With no routine yet, you'll see preset tabs (Strength / Build / Mobility /
   Longevity) and a **Custom** tab.
2. Click the **Custom** tab to start blank.
   - *Faster scaffold option:* open the **Strength** or **Longevity** preset, set **Days 4**,
     **Duration 45**, equipment **Home gym / Full rack**, click **Use this preset**, then edit to
     match. Building from scratch (below) gives an exact match, so that's what this guide does.
3. Set the **routine name** (e.g., `Bookended 4-day`) and an optional **description**.
4. Leave **schedule style** on **Sequence** — the self-paced cycle. Days show as "Day 1–4"; their
   order *is* the cycle order, so add them in the order below.

---

## 2. Add the four days

For each: click **“+ Add a day”**, click the **day name** to rename it, and (recommended) open
**“+ Add a note for this day”** to paste the day's objective from the guide. Add them **in this
order** so the cycle runs Lower A → Upper A → Lower B → Upper B:

1. `Lower A — Squat`
2. `Upper A — Bench & Row`
3. `Lower B — Deadlift`
4. `Upper B — Press & Posture`

---

## 3. Add exercises per day

In a day, click **“+ Add exercises”**, **search the exact name**, tick it, then **“Add N to day.”**
Back in the day, fill the **sets × reps** boxes (seconds where noted). Add them in the order shown —
the app groups each day by module anyway, so this order *is* what you'll see and seed.

**FIXED** = always in the day. **POOL** = a rotating slot: add *all* the listed members now, then in
Section 5 group them and set "do 1 of N." Set each member's sets × reps the same (exceptions noted).

### Day 1 — `Lower A — Squat`
| Exercise (search this name) | Module | Sets | Reps/Sec | Note |
|---|---|---|---|---|
| Banded glute bridges with abduction | Activation Lower | 2 | 12 | opener |
| Hollow hold | Activation Trunk | 3 | **30 sec** | light brace prep |
| Back squat | Strength Barbell | 4 | 5 | FIXED main |
| Romanian deadlift | Strength Barbell | 4 | 8 | FIXED main |
| **POOL · 1 of 3** — Bulgarian squat (seated step away) / Lateral bench step-ups / Bulgarian long-distance squat | Strength Accessory | 3 | 8 | per side · rear foot on flat bench |
| Single-leg balance hold | Balance | 2 | **30 sec** | per side · eyes open → closed |

### Day 2 — `Upper A — Bench & Row`
| Exercise (search this name) | Module | Sets | Reps/Sec | Note |
|---|---|---|---|---|
| Scapular postural band work | Activation Upper | 2 | 10 | opener (posture) |
| Banded face pulls | Activation Upper | 3 | 15 | posture |
| Bench press | Strength Barbell | 4 | 6 | FIXED main · aim 5–8 |
| Barbell row | Strength Barbell | 4 | 8 | FIXED main |
| Pull-ups | Strength Accessory | 3 | *(blank)* | FIXED · AMRAP |
| **POOL · 1 of 3** — Bicep curl / Hammer curl / Banded curl | Strength Accessory | 3 | 10 | |
| **POOL · 1 of 3** — Bench dips / Diamond push-ups / Overhead tricep extension | Strength Accessory | 3 | 10 | dips & diamonds = AMRAP (leave reps blank) |

### Day 3 — `Lower B — Deadlift`
| Exercise (search this name) | Module | Sets | Reps/Sec | Note |
|---|---|---|---|---|
| Banded glute bridges with abduction | Activation Lower | 2 | 12 | opener |
| Conventional deadlift | Strength Barbell | 3 | 5 | FIXED main · take the slack out first |
| Front squat | Strength Barbell | 3 | 5 | FIXED main · elbows up |
| **POOL · 1 of 3** — Dumbbell walking lunges / Reverse lunges / Box step-ups | Strength Accessory | 3 | 8 | per leg |
| **POOL · 1 of 3** — Dumbbell hip thrust / Bodyweight hip thrust / Banded hip thrust | Strength Accessory | 3 | 10 | shoulders on flat bench |
| Half-kneeling Pallof press | Strength Thoracic | 3 | 8 | per side · core finisher |

### Day 4 — `Upper B — Press & Posture`
| Exercise (search this name) | Module | Sets | Reps/Sec | Note |
|---|---|---|---|---|
| Scapular postural band work | Activation Upper | 2 | 10 | opener (posture) |
| Prone Y raises | Activation Upper | 3 | 10 | posture / lower traps |
| Side plank | Activation Trunk | 3 | **30 sec** | per side · light brace prep |
| Overhead press | Strength Barbell | 4 | 6 | FIXED main · ribs down, glutes tight |
| **POOL · 1 of 3** — Dumbbell bench press / Push-ups / Banded chest press | Strength Accessory | 3 | 10 | DB bench is flat |
| **POOL · 1 of 2** — Lateral raises / Banded lateral raise | Strength Accessory | 3 | 12 | light, controlled |
| Hammer curl | Strength Accessory | 3 | 10 | biceps |
| Landmine row | Strength Thoracic | 4 | 8 | FIXED main · **47" bar** · displays last — do it after the press if you like |

> **One rep number; ranges live in your head.** Where the guide gives a range (bench 5–8), enter the
> number you'll hit on every set and push toward the top before adding weight. **AMRAP** (Pull-ups,
> Bench dips, Diamond push-ups) → leave reps blank, log what you get.
>
> **Per side / per leg** → do the listed sets on *each* side; keep it in the note and stay consistent
> so the volume numbers read true.
>
> **Module-order quirk:** Landmine row and Pallof press are in the *Thoracic* module, so they display
> after the dumbbell accessories. The on-screen order is just the default layout — during a session
> you can perform exercises in any order (e.g., Landmine row right after the overhead press).

---

## 4. Save it

Press **Save routine**. It checks that every day has at least one exercise (Sequence mode has no
weekday requirement). On success the page reloads into **Live mode** — now every edit saves on its
own, which you need for the next step.

---

## 5. Set up the rotating slots (pools)

Pools can only be made in **Live mode**. You already added every pool member as a normal exercise in
Section 3; now group each set:

1. In the day header, tap the **pool-grouping** control (layers icon) to enter selection mode — the
   exercise rows show checkboxes.
2. **Check the members of one slot** (e.g., the three single-leg options), then confirm — they
   collapse into a single pool.
3. In the **Pools** panel at the bottom of the day, set the **“do X of Y”** stepper to **1**, and
   optionally name the pool (e.g., "Single-leg").
4. Repeat for each pool, then move to the next day.

At session start on a pooled day, the app asks which member to do, listing the **least-recently-done
first** — take the top suggestion and you'll auto-rotate over the weeks.

**The pools to create:**

| Day | Pool (name it this) | Pick | Members |
|---|---|---|---|
| Lower A | Single-leg | 1 of 3 | Bulgarian squat (seated step away) · Lateral bench step-ups · Bulgarian long-distance squat |
| Upper A | Biceps | 1 of 3 | Bicep curl · Hammer curl · Banded curl |
| Upper A | Triceps | 1 of 3 | Bench dips · Diamond push-ups · Overhead tricep extension |
| Lower B | Lunge | 1 of 3 | Dumbbell walking lunges · Reverse lunges · Box step-ups |
| Lower B | Glute | 1 of 3 | Dumbbell hip thrust · Bodyweight hip thrust · Banded hip thrust |
| Upper B | Chest | 1 of 3 | Dumbbell bench press · Push-ups · Banded chest press |
| Upper B | Shoulder | 1 of 2 | Lateral raises · Banded lateral raise |

**Rules of thumb that keep this clean:**
- **Main lifts are never pooled** — squat, deadlift, bench, overhead press, barbell row, front squat,
  RDL, pull-ups, landmine row stay fixed so "last time" and progression stay meaningful.
- **Each pool's members share a module and a primary muscle** (the lists above already do) — so they
  group cleanly and your weekly Coverage stays stable no matter which one comes up.
- **2–3 members per pool.** More than that and any one variant shows up too rarely to progress.

---

## 6. Optional extras

**Hanging leg raise (you have the bar).** Not a built-in. In the picker open **Add custom** → Name
`Hanging leg raise`, pick **Primary muscle: Core**, save. It appears under the **Custom** group; drop
it into Lower A in place of (or next to) Hollow hold. *(Customs are created rep-based and tagged
"Custom" — fine here.)*

**Per-day objective text.** Paste each day's one-line objective from the guide into its **day
description** so you see the intent when the session loads.

---

## 7. The off-the-clock work (mobility / SMR / snacks)

This deliberately **does not go in the routine** — it's your distributed layer, tracked by *recency*
in the **Coverage** view, not by sets. Two ways to handle it:

- **Simplest:** just do it; whenever those exercises get logged in any session they count for
  recency. The two **openers** above (glute bridges, scapular band work) already keep glutes and
  posture green through your lifting days.
- **If you want it tracked deliberately:** after a quick mobility/SMR round in a one-off session, use
  **save as a template** so you can re-run and log it fast on non-lifting days. (Not required to
  follow the plan — just for keeping Coverage honest.)

---

## Quick gotchas
- One routine per user · max 7 days · can't delete a template that's still a routine day (remove the
  day first).
- In Live mode there's **no save button** — edits persist as you make them.
- Switching Sequence ↔ Weekday clears day pins; stay on **Sequence**.
- Reorder within a day moves exercises *within the same module*; use the day's **Sort by module**
  button to re-sort everything at once.
- A pool needs **2+ members**; dropping it below 2 dissolves it back into a fixed slot.
