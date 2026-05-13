'use client';

// Small InfoTooltip that surfaces the canonical one-line description for a
// given EXERCISE_MODULE (SMR, Mobility, Activation, Strength, Balance, Rev
// Up, plus their body-region splits). Used wherever a module label appears
// in the UI — the routine editor day-card module groups, the routine
// timeline's day breakdown, the exercise picker's section headers, and the
// active workout's section headers.
//
// Falls back to the module name if there's no canonical description (e.g.
// a custom exercise with a module string we don't recognize). Renders the
// ⓘ icon only when there *is* a description, so it doesn't clutter rows
// without anything to surface.

import { InfoTooltip } from './info-tooltip';
import { moduleDescription } from '@/lib/exercises-data';

type Props = {
  module: string;
  size?: number;
  align?: 'start' | 'center' | 'end';
};

export function ModuleInfoTooltip({ module, size = 11, align = 'start' }: Props) {
  const description = moduleDescription(module);
  if (!description) return null;
  return (
    <InfoTooltip label={module} size={size} align={align}>
      <p>{description}</p>
    </InfoTooltip>
  );
}
