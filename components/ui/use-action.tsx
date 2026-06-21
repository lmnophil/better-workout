'use client';

// The client-side counterpart to lib/action-result.ts. Every mutation in the
// app is a server action wrapped by `withLogging`, so it resolves to an
// `ActionResult<T>`: `{ ok: true, data }` on success, `{ ok: false, error }`
// for an expected user-facing failure (the message is UI copy), and a rejected
// promise only for genuine bugs or a dead network.
//
// `useAction` is the one place that knows how to drive that contract from a
// component:
//
//   - It runs the action inside a `useTransition`, *awaiting* it so `isPending`
//     spans the real request. The bare `startTransition(() => { action() })`
//     form that used to be sprinkled everywhere flips pending back almost
//     immediately (React 19 only entangles awaited work), so the `disabled=
//     {isPending}` guards never actually engaged.
//   - Expected failures land in `error` as their message, ready to render
//     wherever the caller decides — a banner, an inline line under a field.
//   - A rejected promise (offline mid-set in the gym, or a server-side bug that
//     `withLogging` already logged with a stack) becomes a friendly inline
//     message too. We deliberately do *not* let it crash to the error boundary:
//     blowing the whole page away is the wrong response to one failed mutation
//     in an offline-capable PWA, and the boundary still catches render-time
//     bugs. See docs/decisions.md for the ADR.
//
// Forms that must await-and-decide for themselves (close-on-success-only
// dialogs like SaveTemplateDialog, the picker's custom-add tab) keep calling
// the action directly and reading `res.ok` — `useAction` is for the fire-and-
// surface handlers, which is most of them.

import { useCallback, useState, useTransition } from 'react';
import { X } from 'lucide-react';
import type { ActionResult } from '@/lib/action-result';

const OFFLINE_MESSAGE = "You're offline — that change wasn't saved. Try again once you're back on.";
const FALLBACK_MESSAGE = 'Something went wrong — please try again.';

type RunOptions<T> = {
  /** Runs on `{ ok: true }`, with the action's data. */
  onSuccess?: (data: T) => void;
  /**
   * Runs on any failure (expected or rejected), with the message that was also
   * stored in `error`. For *side effects* like rolling back an optimistic edit
   * — the message still surfaces via `error`, so this is not where you render
   * it.
   */
  onError?: (message: string) => void;
};

export type UseAction = {
  /** Run an action in a transition; route success/failure to the callbacks + `error`. */
  run: <T>(action: () => Promise<ActionResult<T>>, opts?: RunOptions<T>) => void;
  isPending: boolean;
  /** The most recent failure message, or null. Render it where the user acted. */
  error: string | null;
  /** Clear or set the message directly — e.g. clear it as the user edits an input. */
  setError: (message: string | null) => void;
};

export function useAction(): UseAction {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    <T,>(action: () => Promise<ActionResult<T>>, opts?: RunOptions<T>): void => {
      setError(null);
      startTransition(async () => {
        let res: ActionResult<T>;
        try {
          res = await action();
        } catch {
          // The action call rejected outright. `navigator.onLine === false` is
          // a reliable "definitely offline" signal; otherwise it's a server-
          // side bug (already logged by withLogging) and a generic retry line
          // is the most honest thing we can say.
          const message =
            typeof navigator !== 'undefined' && !navigator.onLine ? OFFLINE_MESSAGE : FALLBACK_MESSAGE;
          setError(message);
          opts?.onError?.(message);
          return;
        }
        if (res.ok) {
          opts?.onSuccess?.(res.data);
        } else {
          setError(res.error);
          opts?.onError?.(res.error);
        }
      });
    },
    [],
  );

  return { run, isPending, error, setError };
}

/**
 * Inline error surface for `useAction`'s `error`. Renders nothing when there's
 * no message, so callers can drop `<ActionError message={error} onDismiss={...}/>`
 * unconditionally wherever the failure should appear.
 */
export function ActionError({
  message,
  onDismiss,
  className = '',
}: {
  message: string | null;
  onDismiss?: () => void;
  className?: string;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad ${className}`}
    >
      <span className="flex-1 min-w-0">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 text-bad/70 hover:text-bad transition"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
