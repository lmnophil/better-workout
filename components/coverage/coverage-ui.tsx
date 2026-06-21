'use client';

// Shared coverage-panel render pieces. The routine editor's CoveragePanel and
// the share view's read-only ShareCoveragePanel drew near-identical muscle rows
// and tier-summary chips over the same TIER_VISUALS table; the markup lived in
// two places and had already drifted. These two components are the single copy.
//
// What stays surface-specific (and so isn't here): the panel chrome (section
// padding, headings, the share view's owner-tier badge), the editor's
// collapsible legend, and the editor's category-heading dominant-tier dot. The
// editor passes `interactive`/`estimated` to opt into its richer affordances;
// the share view leaves them off for a plain read-only row.

import {
  TIER_VISUALS,
  formatSets,
  tierFor as coverageTierFor,
  type CoverageTier,
} from '@/lib/coverage';

// (min, target) for a muscle, or null when it isn't volume-tracked. Mirrors the
// boundsFor/boundsOf adapters the two panels used before — min defaults to half
// the target when unset.
function boundsOf(target: number | null, min: number | null): { min: number; target: number } | null {
  if (target === null || target === 0) return null;
  return { min: min ?? Math.round(target * 0.5), target };
}

export function coverageTierOf(sets: number, target: number | null, min: number | null): CoverageTier {
  return coverageTierFor(sets, boundsOf(target, min));
}

// One muscle row: tier-coloured pill with a progress bar (when the muscle has a
// target) and a "sets/target" readout. `estimated` appends the "?" disclosure
// marker; `interactive` adds the hover-underline affordance + minimum tooltip
// the editor uses (the share view stays plain).
export function CoverageRow({
  label,
  sets,
  target,
  min,
  description,
  estimated = false,
  interactive = false,
}: {
  label: string;
  sets: number;
  target: number | null;
  min: number | null;
  description?: string | null;
  estimated?: boolean;
  interactive?: boolean;
}) {
  const hasTarget = target !== null && target > 0;
  const ratio = hasTarget ? Math.min(sets / target, 1) : 0;
  const minRatio = hasTarget && min !== null && min > 0 ? Math.min(min / target, 1) : 0;
  const tok = TIER_VISUALS[coverageTierOf(sets, target, min)];
  const tooltip = description ? `${label} — ${description}` : label;

  return (
    <div
      className="border rounded px-2.5 py-1.5 flex items-center gap-3"
      style={{ background: tok.bg, borderColor: tok.border }}
      title={tooltip}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: tok.dot }}
        aria-hidden="true"
      />
      <span
        className={`text-[12px] text-ink-100 truncate flex-1 min-w-0${
          interactive ? ' decoration-dotted decoration-ink-700 underline-offset-[3px] hover:underline' : ''
        }`}
      >
        {label}
      </span>

      {hasTarget ? (
        <>
          <div className="relative flex-1 max-w-[120px] h-1.5 bg-ink-900 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.max(ratio * 100, sets > 0 ? 4 : 0)}%`, background: tok.bar }}
            />
            {minRatio > 0 && minRatio < 1 && (
              <div
                className="absolute top-[-2px] bottom-[-2px] w-px bg-ink-500/60"
                style={{ left: `${minRatio * 100}%` }}
                aria-hidden="true"
                title={interactive ? `Minimum: ${min} sets` : undefined}
              />
            )}
          </div>
          <span className="font-mono text-[10px] text-ink-400 shrink-0 w-16 text-right">
            {formatSets(sets)}/{target}
            {estimated && <span className="text-ink-600 ml-0.5">?</span>}
          </span>
        </>
      ) : (
        <span className="font-mono text-[10px] text-ink-500 shrink-0">
          {sets > 0 ? `${formatSets(sets)} sets` : '—'}
        </span>
      )}
    </div>
  );
}

// The tier-count chip strip ("3 on target · 1 gap"). Hidden when nothing falls
// into a graded tier. `className` lets a caller add spacing (the share view
// wants a bottom margin); the editor relies on the following block's top margin.
export function CoverageSummaryStrip({
  summary,
  className,
}: {
  summary: { target: number; ok: number; under: number; gap: number; emphasis: number };
  className?: string;
}) {
  const items = (
    [
      { tier: 'target', label: 'on target', count: summary.target },
      { tier: 'ok', label: 'good', count: summary.ok },
      { tier: 'under', label: 'below min', count: summary.under },
      { tier: 'gap', label: 'gap', count: summary.gap },
      { tier: 'emphasis', label: 'emphasis', count: summary.emphasis },
    ] satisfies { tier: CoverageTier; label: string; count: number }[]
  ).filter((i) => i.count > 0);

  if (items.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-1.5${className ? ` ${className}` : ''}`}>
      {items.map((i) => {
        const tok = TIER_VISUALS[i.tier];
        return (
          <span
            key={i.tier}
            className="inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded-full border"
            style={{ background: tok.bg, borderColor: tok.border }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: tok.dot }} />
            <span className="text-ink-200">{i.count}</span>
            <span className="text-ink-400">{i.label}</span>
          </span>
        );
      })}
    </div>
  );
}
