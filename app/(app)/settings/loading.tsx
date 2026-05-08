// Loading skeleton for the settings page.

export default function Loading() {
  return (
    <div className="px-5 pt-6 pb-10 animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-6">
        <div className="h-3 w-20 bg-ink-800 rounded mb-2" />
        <div className="h-9 w-32 bg-ink-800 rounded" />
      </div>

      <div className="mb-3">
        <div className="h-6 w-48 bg-ink-800 rounded mb-2" />
        <div className="h-3 w-72 bg-ink-800/60 rounded" />
      </div>

      {/* Three category sections */}
      {[0, 1, 2].map((s) => (
        <div key={s} className="mb-6">
          <div className="h-3 w-20 bg-ink-800 rounded mb-2" />
          <div className="space-y-1.5">
            {[0, 1, 2].map((r) => (
              <div key={r} className="h-14 bg-ink-800/30 rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
