// 404 / revoked share — same screen for both. We deliberately don't tell the
// visitor whether the token was bogus vs. revoked; revealing that distinction
// helps nobody and gives a tiny info-leak vector against the unguessable
// token (an attacker enumerating tokens would learn which ids were real).

export default function ShareNotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-2">
          Workout Tracker
        </div>
        <h1 className="font-display text-3xl mb-3">Share link unavailable</h1>
        <p className="text-ink-300 text-sm">
          This link isn’t active. It may have been revoked, or the address may be off by a
          character. Ask the person who shared it for a fresh link.
        </p>
      </div>
    </main>
  );
}
