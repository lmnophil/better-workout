// Sign-out button. Uses a server action wired to Auth.js's signOut helper.

import { signOut } from '@/auth';
import { LogOut } from 'lucide-react';

export function SignOutButton() {
  async function doSignOut() {
    'use server';
    await signOut({ redirectTo: '/signin' });
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
