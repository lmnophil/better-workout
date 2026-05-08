'use client';

// Confirm dialog — replacement for native confirm().
// Promise-based API: `if (!await confirm({ title: '...' })) return;`
//
// Usage:
//   const { confirm, Dialog } = useConfirm();
//   ...
//   const handleDelete = async () => {
//     if (!await confirm({ title: 'Delete?', variant: 'danger' })) return;
//     // proceed
//   };
//   ...
//   return <>...{Dialog}</>;

import { useState, useCallback, useEffect, type ReactNode } from 'react';

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
};

type ConfirmState = ConfirmOptions & { resolve: (result: boolean) => void };

export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  Dialog: ReactNode;
} {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...options, resolve });
    });
  }, []);

  const close = useCallback(
    (result: boolean) => {
      state?.resolve(result);
      setState(null);
    },
    [state],
  );

  const Dialog = state ? (
    <ConfirmDialog
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      variant={state.variant ?? 'default'}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  ) : null;

  return { confirm, Dialog };
}

function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant,
  onConfirm,
  onCancel,
}: Required<Pick<ConfirmOptions, 'title' | 'variant'>> &
  Pick<ConfirmOptions, 'message' | 'confirmLabel' | 'cancelLabel'> & {
    onConfirm: () => void;
    onCancel: () => void;
  }) {
  // ESC closes, Enter confirms — matches native confirm() expectations
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onConfirm, onCancel]);

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div
        className="bg-ink-950 border border-ink-800 rounded-2xl w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-title" className="font-display text-xl mb-2 text-ink-100">
          {title}
        </h3>
        {message && (
          <p className="text-sm text-ink-300 leading-relaxed mb-4">{message}</p>
        )}
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 border border-ink-800 rounded-lg py-2.5 text-sm text-ink-200 hover:border-ink-600 transition"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className={`flex-1 rounded-lg py-2.5 text-sm font-semibold tracking-wide transition ${
              variant === 'danger'
                ? 'bg-bad text-ink-100 hover:brightness-110'
                : 'accent-bg text-ink-950 hover:brightness-110'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
