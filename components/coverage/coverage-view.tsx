// Coverage view — visualizes recency (color gradient) + weekly volume (bar
// with min/target markers) per muscle group, organized by category.
//
// Two axes of signal:
//   - Recency: when was this muscle last worked? Tier from days-since.
//   - Volume: how many weighted sets this week? Tier from (min, target).
//
// Both axes use the same colour language: green = good, amber = thin, red =
// neglected/gap, blue = emphasis (informational — too much, possibly on
// purpose).

import Link from 'next/link';
import { daysBetween, relativeDay } from '@/lib/utils';
import {
  TIER_VISUALS,
  VOLUME_TIER_LABELS,
  formatSets,
  tierFor,
  type CoverageTier,
  type VolumeTier,
} from '@/lib/coverage';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import {
  ExplainCoverageTiers,
  ExplainRecencyTiers,
  ExplainVolumeTiers,
  ExplainWeeklyVolume,
} from '@/lib/explanations';
import { regionFromCategory, REGION_STYLES } from '@/lib/region-color';
import { CATEGORY_LABELS, type MuscleCategory } from '@/lib/exercises-data';

export type MuscleStatus = {
  id: string;
  label: string;
  category: 'lower' | 'upper' | 'trunk' | 'mobility' | 'other';
  lastWorked: string | null; // ISO
  volumeThisWeek: number;
  // Effective minimum and target from the user's tier + per-muscle override.
  // Both null for recency-only muscles (mobility, balance, cardio).
  min: number | null;
  target: number | null;
  isOverridden: boolean;
};

// Recency thresholds (days) → tier. Independent from the volume tier model —
// "did I work this lately?" is a different question than "am I doing enough?".
type RecencyTier = 'fresh' | 'recent' | 'stale' | 'neglected' | 'never';

function recencyTierFor(daysSince: number | null): RecencyTier {
  if (daysSince === null) return 'never';
  if (daysSince <= 2) return 'fresh';
  if (daysSince <= 4) return 'recent';
  if (daysSince <= 7) return 'stale';
  return 'neglected';
}

const RECENCY_COLORS: Record<RecencyTier, { bg: string; dot: string; label: string }> = {
  fresh: { bg: 'rgba(132, 204, 22, 0.15)', dot: '#84cc16', label: 'Recent' },
  recent: { bg: 'rgba(101, 153, 64, 0.12)', dot: '#659940', label: 'Good' },
  stale: { bg: 'rgba(180, 100, 70, 0.12)', dot: '#b46446', label: 'Stale' },
  neglected: { bg: 'rgba(220, 80, 60, 0.15)', dot: '#dc503c', label: 'Neglected' },
  never: { bg: 'rgba(60, 50, 45, 0.3)', dot: '#3a2f25', label: 'Never' },
};

// Calendar days since a muscle was last worked, resolved in the user's zone.
// This is a server component, so "local" must be the user's timezone, not the
// container's — hence the explicit `timeZone`. Shares lib/utils#daysBetween so
// the day-boundary truncation lives in exactly one place.
function daysSince(iso: string | null, timeZone: string): number | null {
  return iso ? daysBetween(new Date(iso), new Date(), timeZone) : null;
}

export function CoverageView({
  muscles,
  tier,
  timeZone,
}: {
  muscles: MuscleStatus[];
  tier: VolumeTier;
  timeZone: string;
}) {
  // Group by category in the order they appear in MUSCLE_GROUPS
  const byCategory = new Map<MuscleStatus['category'], MuscleStatus[]>();
  for (const m of muscles) {
    let bucket = byCategory.get(m.category);
    if (!bucket) {
      bucket = [];
      byCategory.set(m.category, bucket);
    }
    bucket.push(m);
  }

  const hasAnyData = muscles.some((m) => m.lastWorked !== null);

  return (
    <div className="px-5 pt-6 pb-10">
      <div className="mb-5">
        <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-1">
          Recovery & balance
        </div>
        <h1
          className="font-display text-3xl tracking-tight flex items-center gap-2"
          style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 30" }}
        >
          Coverage
          <InfoTooltip label="Weekly volume" size={16}>
            {ExplainWeeklyVolume}
          </InfoTooltip>
        </h1>
        <p className="text-sm text-ink-400 italic font-display mt-1">
          What you&apos;ve worked recently, and what could use attention.
        </p>
        <div className="mt-2 text-[11px] text-ink-500 inline-flex items-center gap-1">
          Volume tier:{' '}
          <Link
            href="/settings"
            className="text-ink-300 hover:text-ink-100 underline decoration-dotted underline-offset-[3px]"
          >
            {VOLUME_TIER_LABELS[tier]}
          </Link>
          <InfoTooltip label="Volume tiers">{ExplainVolumeTiers}</InfoTooltip>
        </div>
      </div>

      {!hasAnyData && (
        <div className="border border-dashed border-ink-800 rounded-xl p-6 text-center mb-5">
          <p className="text-sm text-ink-400">Complete a workout to see your coverage here.</p>
        </div>
      )}

      <Legend />

      {Array.from(byCategory.entries()).map(([category, items]) => {
        const region = regionFromCategory(category as MuscleCategory);
        const regionStyles = REGION_STYLES[region];
        return (
          <section key={category} className="mb-8">
            <div className="mb-3 flex items-center gap-2">
              <span
                className={`w-1.5 h-4 rounded-full ${regionStyles.dot}`}
                aria-hidden="true"
              />
              <span
                className={`text-[11px] tracking-[0.22em] uppercase font-medium ${regionStyles.text}`}
              >
                {CATEGORY_LABELS[category]}
              </span>
            </div>
            <div className="space-y-2">
              {items.map((m) => (
                <MuscleRow key={m.id} muscle={m} timeZone={timeZone} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Legend() {
  // Two short rows: recency colours up top, volume colours below. Keeps the
  // mapping discoverable without burning vertical space. Each row label gets
  // an info icon so the user can drill into what the tiers actually mean.
  return (
    <div className="mb-6 space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[10px] tracking-wider uppercase text-ink-400">
        <span className="text-ink-500 mr-0.5 inline-flex items-center gap-1">
          recency
          <InfoTooltip label="Recency tiers" size={11} align="start">
            {ExplainRecencyTiers}
          </InfoTooltip>
        </span>
        {(['fresh', 'recent', 'stale', 'neglected', 'never'] as RecencyTier[]).map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: RECENCY_COLORS[t].dot }}
            />
            <span>{RECENCY_COLORS[t].label}</span>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[10px] tracking-wider uppercase text-ink-400">
        <span className="text-ink-500 mr-0.5 inline-flex items-center gap-1">
          volume
          <InfoTooltip label="Volume tiers" size={11} align="start">
            {ExplainCoverageTiers}
          </InfoTooltip>
        </span>
        {(['gap', 'under', 'ok', 'target', 'emphasis'] as CoverageTier[]).map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: TIER_VISUALS[t].dot }}
            />
            <span>{TIER_VISUALS[t].label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function MuscleRow({ muscle, timeZone }: { muscle: MuscleStatus; timeZone: string }) {
  const d = daysSince(muscle.lastWorked, timeZone);
  const rTier = recencyTierFor(d);
  const rColors = RECENCY_COLORS[rTier];
  const recencyLabel = muscle.lastWorked
    ? relativeDay(new Date(muscle.lastWorked), new Date(), timeZone)
    : 'never';

  const hasTarget = muscle.target !== null && muscle.target > 0;
  const min = muscle.min ?? 0;
  const target = muscle.target ?? 0;
  const sets = muscle.volumeThisWeek;

  // Volume tier from (sets, min, target). Drives the bar fill colour and the
  // small status chip; the row's background still reflects recency so the
  // recency-vs-volume signal stays visually separable.
  const vTier: CoverageTier = hasTarget
    ? tierFor(sets, { min, target })
    : 'untracked';

  // Bar fill ratio: cap at target so "100% bar" === "hit target". Emphasis
  // visually breaches the bar; render that as a full bar tinted blue.
  const ratio = hasTarget ? Math.min(sets / target, 1) : 0;
  const minRatio = hasTarget && target > 0 ? min / target : 0;

  return (
    <div
      className="rounded-lg px-3 py-2.5 border border-ink-800"
      style={{ background: rColors.bg }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: rColors.dot }}
            aria-hidden="true"
            title={`Last worked: ${recencyLabel}`}
          />
          <span className="text-sm text-ink-100 truncate">{muscle.label}</span>
          {hasTarget && vTier !== 'ok' && vTier !== 'target' && (
            <span
              className="text-[9px] tracking-wider uppercase px-1.5 py-0.5 rounded shrink-0"
              style={{
                color: TIER_VISUALS[vTier].dot,
                background: TIER_VISUALS[vTier].bg,
                border: `1px solid ${TIER_VISUALS[vTier].border}`,
              }}
              title={chipTitle(vTier)}
            >
              {TIER_VISUALS[vTier].label}
            </span>
          )}
        </div>
        <span className="font-mono text-[11px] text-ink-400 shrink-0">{recencyLabel}</span>
      </div>

      {hasTarget && (
        <div className="mt-2 flex items-center gap-2.5">
          <div className="relative flex-1 h-1.5 bg-ink-900 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max(ratio * 100, sets > 0 ? 4 : 0)}%`,
                background: TIER_VISUALS[vTier].bar,
              }}
            />
            {minRatio > 0 && minRatio < 1 && (
              <div
                className="absolute top-[-2px] bottom-[-2px] w-px bg-ink-500/60"
                style={{ left: `${minRatio * 100}%` }}
                aria-hidden="true"
                title={`Minimum: ${min} sets`}
              />
            )}
          </div>
          <span className="font-mono text-[10px] text-ink-400 shrink-0">
            {formatSets(sets)}/{target}
            {muscle.isOverridden && <span className="text-ink-600 ml-1">·custom</span>}
          </span>
        </div>
      )}
    </div>
  );
}

function chipTitle(tier: CoverageTier): string {
  switch (tier) {
    case 'gap':
      return 'No sets logged this week.';
    case 'under':
      return 'Below the minimum for this tier — worth adding work.';
    case 'emphasis':
      return 'Well above target — could be deliberate specialization.';
    default:
      return TIER_VISUALS[tier].label;
  }
}
