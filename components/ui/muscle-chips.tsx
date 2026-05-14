// Inline list of muscle pills for an exercise. Each pill is tinted with its
// muscle's body-region color (upper/lower/core/mobility/other) so the user can
// glance at a row and read what the lift hits without parsing the name.
//
// Primaries render as filled tinted pills; secondaries render as outline-only
// at reduced opacity so the priority order (primaries are what the lift is
// "for") survives the visual. The two groups sit on the same line and wrap
// together — keeping them inline preserves the read at narrow widths and
// matches the EquipmentChips voice next door.
//
// Region color comes from `regionFromMuscleId` (lib/region-color.ts), which
// translates schema MuscleCategory → UI Region. Tailwind class strings are
// listed literally in REGION_STYLES so the JIT scanner picks them up; the
// safelist in tailwind.config.ts covers the opacity-modified variants used
// here.

import { muscleLabel } from '@/lib/exercises-data';
import { regionFromMuscleId, REGION_STYLES } from '@/lib/region-color';

type Props = {
  primary: string[];
  secondary?: string[];
  className?: string;
};

export function MuscleChips({ primary, secondary = [], className = '' }: Props) {
  if (primary.length === 0 && secondary.length === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1 flex-wrap ${className}`}>
      {primary.map((id) => {
        const styles = REGION_STYLES[regionFromMuscleId(id)];
        return (
          <span
            key={`p-${id}`}
            className={`text-[9px] tracking-wide uppercase rounded-full px-1.5 py-px border ${styles.bg} ${styles.text} ${styles.borderTint}`}
          >
            {muscleLabel(id)}
          </span>
        );
      })}
      {secondary.map((id) => {
        const styles = REGION_STYLES[regionFromMuscleId(id)];
        return (
          <span
            key={`s-${id}`}
            className={`text-[9px] tracking-wide uppercase rounded-full px-1.5 py-px border opacity-60 ${styles.text} ${styles.borderTint}`}
          >
            {muscleLabel(id)}
          </span>
        );
      })}
    </span>
  );
}
