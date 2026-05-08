// Magic link "check your email" page. Auth.js redirects here automatically
// after the user submits their email on the sign-in page.

export const metadata = {
  title: 'Check your email — Workout Tracker',
};

export default function VerifyRequestPage() {
  return (
    <div className="text-center">
      <div className="text-[10px] tracking-[0.25em] uppercase text-ink-400 mb-2">
        Workout Tracker
      </div>
      <h1
        className="font-display text-3xl tracking-tight text-ink-100 mb-4"
        style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 30" }}
      >
        Check your email
      </h1>
      <p className="text-sm text-ink-300 leading-relaxed mb-6">
        We sent a magic link to your inbox. Click it to finish signing in.
      </p>
      <p className="text-xs text-ink-500 italic font-display">
        Didn&apos;t arrive? Check spam, or{' '}
        <a href="/signin" className="accent-text underline underline-offset-2 hover:no-underline">
          try again
        </a>
        .
      </p>
    </div>
  );
}
