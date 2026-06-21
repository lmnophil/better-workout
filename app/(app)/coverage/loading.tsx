// Loading skeleton for the coverage page.

export default function Loading() {
  return (
    <div className="px-5 pt-6 pb-10 animate-pulse" aria-busy="true" aria-label="Loading">
      {/* Header */}
      <div className="mb-5">
        <div className="h-3 w-28 bg-ink-800 rounded mb-2" />
        <div className="h-9 w-36 bg-ink-800 rounded mb-2" />
        <div className="h-3 w-72 bg-ink-800/60 rounded" />
      </div>

      {/* Legend placeholder */}
      <div className="flex gap-4 mb-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-3 w-16 bg-ink-800/60 rounded" />
        ))}
      </div>

      {/* Three sections of muscle rows */}
      {[0, 1, 2].map((sectionIdx) => (
        <div key={sectionIdx} className="mb-7">
          <div className="h-3 w-20 bg-ink-800 rounded mb-3" />
          <div className="space-y-1.5">
            {[0, 1, 2, 3].map((rowIdx) => (
              <div key={rowIdx} className="h-14 bg-ink-800/30 rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
