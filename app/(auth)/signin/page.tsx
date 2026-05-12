// Sign-in page — Google OAuth + Resend magic link.
//
// Server actions invoke Auth.js's signIn helper. Auth.js handles redirects
// through its own thrown-redirect pattern, so we don't manually return them.

import { signIn } from '@/auth';
import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { magicLinkPerIp, magicLinkPerEmail } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request';
import { SwSignoutCleanup } from '@/components/auth/sw-signout-cleanup';

export const metadata = {
  title: 'Sign in — Workout Tracker',
};

export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string; cleanup?: string }>;
}) {
  return <SignInForm searchParamsPromise={searchParams} />;
}

async function SignInForm({
  searchParamsPromise,
}: {
  searchParamsPromise: Promise<{ callbackUrl?: string; error?: string; cleanup?: string }>;
}) {
  const params = await searchParamsPromise;
  const callbackUrl = params.callbackUrl ?? '/';
  const error = params.error;
  // Sentinel set by the signout server action and the stale-cookie recovery
  // route. When present, the client-side cleaner posts a message to the SW
  // to drop user-scoped caches before the next user signs in.
  const cleanupAfterSignout = params.cleanup === '1';

  async function googleSignIn() {
    'use server';
    try {
      await signIn('google', { redirectTo: callbackUrl });
    } catch (err) {
      // Auth.js throws a redirect on success — re-throw so Next.js handles it
      if (err instanceof AuthError) {
        redirect(`/signin?error=${err.type}`);
      }
      throw err;
    }
  }

  async function emailSignIn(formData: FormData) {
    'use server';
    const email = formData.get('email');
    if (typeof email !== 'string' || !email.includes('@')) {
      redirect('/signin?error=InvalidEmail');
    }

    // Rate limit: gate magic-link sends so a bad actor can't spam Resend or
    // burn somebody else's inbox. Two limiters — by IP (anti-bot) and by
    // email (anti-targeting). Either one tripping rejects the request.
    const ip = await getClientIp();
    const ipCheck = magicLinkPerIp.check(`magiclink:ip:${ip}`);
    const emailCheck = magicLinkPerEmail.check(`magiclink:email:${email.toLowerCase()}`);

    if (!ipCheck.allowed || !emailCheck.allowed) {
      redirect('/signin?error=RateLimited');
    }

    try {
      await signIn('resend', {
        email,
        redirectTo: callbackUrl,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        redirect(`/signin?error=${err.type}`);
      }
      throw err;
    }
  }

  return (
    <div>
      <SwSignoutCleanup active={cleanupAfterSignout} />
      <div className="mb-8">
        <div className="text-[10px] tracking-[0.25em] uppercase text-ink-400 mb-2">
          Workout Tracker
        </div>
        <h1
          className="font-display text-4xl tracking-tight text-ink-100"
          style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 30" }}
        >
          Sign in
        </h1>
        <p className="text-sm text-ink-400 italic font-display mt-1">
          Pick one — both methods will land you in the same place.
        </p>
      </div>

      {error && <ErrorBanner error={error} />}

      <form action={googleSignIn} className="mb-4">
        <button
          type="submit"
          className="w-full bg-ink-100 text-ink-950 py-3 rounded-lg font-medium tracking-wide hover:brightness-95 transition flex items-center justify-center gap-2"
        >
          <GoogleLogo />
          Continue with Google
        </button>
      </form>

      <div className="flex items-center gap-3 my-5">
        <div className="flex-1 h-px bg-ink-800" />
        <span className="text-[10px] tracking-[0.25em] uppercase text-ink-500">or</span>
        <div className="flex-1 h-px bg-ink-800" />
      </div>

      <form action={emailSignIn} className="space-y-2">
        <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block">Email</label>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="w-full bg-ink-900 border border-ink-800 rounded-lg px-3 py-2.5 text-sm text-ink-100 focus:outline-none focus:border-accent/50"
        />
        <button
          type="submit"
          className="w-full accent-bg text-ink-950 py-3 rounded-lg font-semibold tracking-wide hover:brightness-110 transition"
        >
          Send magic link
        </button>
      </form>

      <p className="text-xs text-ink-500 mt-6 text-center font-display italic">
        New here? Either method creates your account automatically.
      </p>
    </div>
  );
}

function ErrorBanner({ error }: { error: string }) {
  const message = errorMessage(error);
  return (
    <div className="bg-bad/10 border border-bad/40 text-ink-100 rounded-lg px-3 py-2 text-sm mb-4">
      {message}
    </div>
  );
}

function errorMessage(code: string): string {
  switch (code) {
    case 'OAuthAccountNotLinked':
      return 'That email is already registered with a different sign-in method. Try the other option.';
    case 'EmailSignin':
      return "Couldn't send the magic link. Double-check the email and try again.";
    case 'InvalidEmail':
      return 'That email address looks invalid.';
    case 'RateLimited':
      return 'Too many sign-in attempts. Wait a few minutes and try again.';
    case 'AccessDenied':
      return 'Access denied.';
    default:
      return 'Something went wrong. Try again.';
  }
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
