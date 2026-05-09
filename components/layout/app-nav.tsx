'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, BarChart3, ListChecks } from 'lucide-react';

const TABS = [
  { href: '/', label: 'Workout', icon: Activity },
  { href: '/routine', label: 'Routine', icon: ListChecks },
  { href: '/coverage', label: 'Coverage', icon: BarChart3 },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav
      className={`
        flex bg-ink-950
        fixed bottom-0 left-0 right-0 z-30 border-t border-ink-800
        sm:static sm:border-t-0 sm:border-b
      `}
    >
      {TABS.map((tab) => {
        const isActive =
          tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex-1 py-3 text-[10px] sm:text-xs tracking-[0.2em] uppercase transition flex items-center justify-center gap-2 ${
              isActive
                ? 'accent-text border-t-2 sm:border-t-0 sm:border-b-2 accent-border'
                : 'text-ink-500 hover:text-ink-300'
            }`}
          >
            <Icon size={14} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
