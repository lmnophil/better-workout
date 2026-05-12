'use client';

// PWA install banner — appears on mobile when the app isn't installed yet.
// Two paths:
//   - Chrome/Edge/Android: capture beforeinstallprompt, show "Install" button
//   - iOS Safari: that event isn't fired, so show manual instructions instead
//
// State persists in localStorage so users aren't nagged after dismissing.

import { useEffect, useState } from 'react';
import { Plus, X, Share } from 'lucide-react';

const DISMISSED_KEY = 'pwa-install-dismissed-v1';

// The beforeinstallprompt event isn't in the standard TypeScript lib yet.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function PWAInstallBanner() {
  const [show, setShow] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Don't show if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    // iOS-specific check (Safari sets navigator.standalone when installed)
    if ((window.navigator as { standalone?: boolean }).standalone === true) return;

    // Don't show if dismissed. localStorage access can throw under some
    // strict-privacy settings (Safari ITP in private mode) — treat any read
    // failure as "not dismissed" so the banner can still appear.
    try {
      if (localStorage.getItem(DISMISSED_KEY)) return;
    } catch {
      // ignore — fall through to detection
    }

    // iOS Safari path — no beforeinstallprompt event, just show instructions.
    // iPadOS 13+ reports a Mac UA in Safari ("desktop site" by default), so
    // the legacy /iPad|iPhone|iPod/ check misses iPads entirely. Detect by
    // combining UA with a touch-capable Mac heuristic (real Macs report
    // maxTouchPoints === 0; touch iPads report 5).
    const ua = navigator.userAgent;
    const isLegacyIDevice =
      /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    const isModernIPad =
      /Macintosh/.test(ua) &&
      typeof navigator.maxTouchPoints === 'number' &&
      navigator.maxTouchPoints > 1 &&
      !/CriOS|FxiOS|EdgiOS/.test(ua);
    if (isLegacyIDevice || isModernIPad) {
      setIsIOS(true);
      setShow(true);
      return;
    }

    // Chrome/Android path — capture the install event when fired
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, Date.now().toString());
    } catch {
      // localStorage might be disabled (private mode etc) — banner just won't reappear this session
    }
    setShow(false);
  }

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === 'accepted' || choice.outcome === 'dismissed') {
      // Either way, don't keep showing
      dismiss();
    }
  }

  if (!show) return null;

  return (
    <div className="px-5 py-3 bg-ink-900 border-b border-ink-800 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-xs text-ink-100">
          {isIOS ? (
            <>
              Add to home screen: tap{' '}
              <Share size={12} className="inline -mt-0.5 text-ink-300" /> then{' '}
              <span className="text-ink-300">&ldquo;Add to Home Screen&rdquo;</span>
            </>
          ) : (
            <>Install for offline access and faster startup.</>
          )}
        </div>
      </div>

      {!isIOS && installEvent && (
        <button
          onClick={install}
          className="accent-bg text-ink-950 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide hover:brightness-110 transition flex items-center gap-1 shrink-0"
        >
          <Plus size={12} strokeWidth={2.5} />
          Install
        </button>
      )}

      <button
        onClick={dismiss}
        className="text-ink-500 hover:text-ink-100 transition p-1 -mr-1 shrink-0"
        aria-label="Dismiss install prompt"
      >
        <X size={16} />
      </button>
    </div>
  );
}
