// Sign-out button. Uses a server action wired to Auth.js's signOut helper.

import { signOut } from '@/auth';
import { LogOut } from 'lucide-react';

export function SignOutButton() {
  async function doSignOut() {
    'use server';
    // `?cleanup=1` is the sentinel the signin page reads to ask the service
    // worker to drop user-scoped caches before the next session. Without it,
    // a network blip could let the next user see the previous user's
    // SW-cached HTML. See components/auth/sw-signout-cleanup.tsx.
    await signOut({ redirectTo: '/signin?cleanup=1' });
  }

  return (
    <form action={doSignOut}>
      <button
        type="submit"
        className="text-[10px] tracking-[0.25em] uppercase text-ink-400 hover:text-ink-100 transition flex items-center gap-1.5"
        aria-label="Sign out"
      >
        <LogOut size={12} />
        Sign out
      </button>
    </form>
  );
}
