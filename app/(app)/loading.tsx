// Loading skeleton for the workout page. Shown while server data fetches.
// Matches the rough layout of the real page so there's no jarring shift.

export default function Loading() {
  return (
    <div className="px-5 pt-6 pb-32 animate-pulse" aria-busy="true" aria-label="Loading">
      {/* Header area */}
      <div className="mb-6">
        <div className="h-3 w-24 bg-ink-800 rounded mb-2" />
        <div className="h-9 w-56 bg-ink-800 rounded mb-2" />
        <div className="h-3 w-40 bg-ink-800/60 rounded" />
      </div>

      {/* Two exercise card placeholders */}
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <div key={i} className="border border-ink-800 rounded-lg p-4">
            <div className="h-3 w-20 bg-ink-800 rounded mb-2" />
            <div className="h-4 w-48 bg-ink-800 rounded mb-3" />
            <div className="space-y-2">
              <div className="h-8 bg-ink-800/40 rounded" />
              <div className="h-8 bg-ink-800/40 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
