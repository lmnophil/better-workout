'use client';

// The shared modal shell. The backdrop, the bordered panel, role="dialog" /
// aria-modal, click-to-close, Escape-to-close, and a real focus trap (move
// focus in on open, trap Tab inside, restore focus to the opener on close)
// were re-implemented in seven dialogs and only one of them — the pool-pick
// dialog — had the full focus trap; the rest declared aria-modal while Tab
// walked the page behind the overlay. This is the single copy.
//
// Callers supply the panel's width/layout classes and the dialog's content;
// the shell owns the chrome and the keyboard behaviour. Initial focus is the
// panel by default (so the trap has somewhere to start); pass `initialFocus`
// to focus an input or button instead. Do NOT use the native `autoFocus`
// attribute on children — it fires before this component's effect and would
// steal the opener capture used for focus restoration.

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

// Everything Tab can land on inside the dialog — used by the focus trap.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ModalShell({
  onClose,
  isSubmitting = false,
  inert = false,
  panelClassName,
  zClassName = 'z-50',
  overlayClassName,
  labelledBy,
  ariaLabel,
  initialFocus,
  children,
}: {
  // Dismiss request (Escape, backdrop). The shell never calls this while
  // `isSubmitting` — an in-flight submit shouldn't be abandoned by a stray
  // Escape or a mis-tap on the backdrop.
  onClose: () => void;
  isSubmitting?: boolean;
  // True when another dialog is open above this one: the shell stops handling
  // the keyboard and backdrop so the dialog on top owns them. Lets a dialog
  // host a nested confirm without two focus traps fighting over Tab.
  inert?: boolean;
  // Classes for the bordered panel: width + corner rounding + layout. The
  // shared base (background, border, full width, focus outline reset) is
  // applied here so callers can't diverge on it.
  panelClassName?: string;
  // z-index utility for the overlay. A couple of dialogs that open above other
  // overlays pass `z-[60]`.
  zClassName?: string;
  // Extra overlay classes (e.g. the confirm dialog's `p-4` gutter).
  overlayClassName?: string;
  labelledBy?: string;
  ariaLabel?: string;
  // Element to focus on open. Defaults to the panel itself.
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Move focus into the dialog on open and restore it to the opener on close,
  // so keyboard and screen-reader users aren't dumped at the top of the page.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    (initialFocus?.current ?? panelRef.current)?.focus();
    return () => previouslyFocused?.focus();
  }, [initialFocus]);

  // Escape closes (subject to the submit guard); Tab is trapped inside the
  // panel. Suspended while `inert`.
  useEffect(() => {
    if (inert) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (!isSubmitting) onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        // Nothing tabbable (e.g. every control disabled while submitting) —
        // keep focus pinned to the panel rather than letting it escape.
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || active === panel) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [inert, isSubmitting, onClose]);

  return (
    <div
      className={`fixed inset-0 bg-black/70 ${zClassName} flex items-end sm:items-center justify-center${
        overlayClassName ? ` ${overlayClassName}` : ''
      }`}
      onClick={() => {
        if (!isSubmitting && !inert) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-label={ariaLabel}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`bg-ink-950 border border-ink-800 w-full focus:outline-none${
          panelClassName ? ` ${panelClassName}` : ''
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
