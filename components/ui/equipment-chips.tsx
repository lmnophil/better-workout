// Small inline list of equipment tokens for an exercise. Used wherever an
// exercise is listed alongside its requirements — routine timeline, active
// workout, routine editor — so the user can see at a glance what they need.
//
// Style is intentionally muted: this is reference info, not a primary action.
// 'mat' shows like any other token; the picker treats it as informational
// rather than gating, but in this list it's just one more thing to grab.

type Props = {
  equipment: string[];
  className?: string;
};

export function EquipmentChips({ equipment, className = '' }: Props) {
  if (equipment.length === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1 flex-wrap ${className}`}>
      {equipment.map((e) => (
        <span
          key={e}
          className="text-[9px] tracking-wide uppercase text-ink-500 border border-ink-800 rounded-full px-1.5 py-px"
        >
          {e}
        </span>
      ))}
    </span>
  );
}
