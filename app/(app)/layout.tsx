// Layout for authenticated routes. Loads the session server-side and gates
// access — middleware handles the redirect, but we double-check here to be safe
// (defense in depth, and gives us session.user in child server components).
//
// Wraps children in PrefsProvider so the cue toggle in the header and the
// rest timer in the workout view share one piece of state. Without that,
// they each kept their own optimistic mirror and could disagree visually.

import Link from 'next/link';
import { Settings as SettingsIcon } from 'lucide-react';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { SignOutButton } from '@/components/auth/signout-button';
import { AppNav } from '@/components/layout/app-nav';
import { PWAInstallBanner } from '@/components/ui/pwa-install-banner';
import { CueToggle } from '@/components/ui/cue-toggle';
import { PrefsProvider } from '@/components/ui/prefs-context';
import { getUserPreferences } from '@/lib/queries';
import { NotificationBell } from '@/components/layout/notification-bell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    // Route through the recover endpoint instead of straight to /signin so the
    // stale session cookie gets cleared on the way. Otherwise middleware (which
    // uses the Edge-safe auth config and can't see that the JWT's user no
    // longer exists in the DB) keeps treating the cookie as valid and bounces
    // the user back into the protected area — see app/api/auth/recover/route.ts.
    redirect('/api/auth/recover');
  }
  const userId = session.user.id;

  // Pull a friendly greeting handle: first name, else email local-part
  const handle = session.user.name?.split(' ')[0] ?? session.user.email?.split('@')[0] ?? 'athlete';

  const preferences = await getUserPreferences(userId);

  return (
    <PrefsProvider initial={preferences}>
      <div className="min-h-screen flex flex-col">
        <PWAInstallBanner />
        <header className="px-5 py-4 border-b border-ink-800 flex items-center justify-between">
          <div>
            <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500">
              Workout Tracker
            </div>
            <div className="text-xs text-ink-300 mt-0.5">
              Hi, <span className="text-ink-100">{handle}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <CueToggle />
            <NotificationBell userId={userId} />
            <Link
              href="/settings"
              aria-label="Settings"
              className="p-2 text-ink-400 hover:text-ink-100 transition"
            >
              <SettingsIcon size={16} />
            </Link>
            <SignOutButton />
          </div>
        </header>
        <AppNav />
        <div className="flex-1 pb-14 sm:pb-0">{children}</div>
      </div>
    </PrefsProvider>
  );
}
