'use client';

// Hidden default templates editor. Lists the built-in templates the user has
// hidden from their workout-page list, with a one-tap "Bring back" action
// that calls unhideTemplate. When nothing is hidden, renders a small empty
// state instead of an empty card so the section reads cleanly.

import { useTransition } from 'react';
import { RotateCcw } from 'lucide-react';
import { unhideTemplate } from '@/lib/actions';

type HiddenTemplate = {
  templateId: string;
  name: string;
  description: string | null;
  exerciseCount: number;
};

export function HiddenTemplatesEditor({ templates }: { templates: HiddenTemplate[] }) {
  if (templates.length === 0) {
    return (
      <p className="text-xs text-ink-500 italic font-display">
        Nothing hidden right now. Defaults you hide from the workout page show up here.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {templates.map((t) => (
        <Row key={t.templateId} template={t} />
      ))}
    </div>
  );
}

function Row({ template }: { template: HiddenTemplate }) {
  const [isPending, startTransition] = useTransition();

  function handleUnhide() {
    startTransition(() => {
      unhideTemplate({ templateId: template.templateId });
    });
  }

  return (
    <div className="border border-ink-800 rounded-lg flex items-stretch">
      <div className="flex-1 px-4 py-3 min-w-0">
        <div className="text-sm text-ink-100 flex items-center gap-2">
          <span className="truncate">{template.name}</span>
          <span className="text-[9px] tracking-[0.2em] uppercase text-ink-500 border border-ink-800 rounded px-1.5 py-0.5 shrink-0">
            Default
          </span>
        </div>
        <div className="text-[11px] text-ink-500 mt-0.5">
          {template.exerciseCount} {template.exerciseCount === 1 ? 'exercise' : 'exercises'}
          {template.description && <span className="text-ink-600"> · {template.description}</span>}
        </div>
      </div>
      <button
        onClick={handleUnhide}
        disabled={isPending}
        className="px-4 text-ink-400 hover:accent-text transition border-l border-ink-800 disabled:opacity-50 flex items-center gap-1.5 text-[11px] tracking-wider uppercase"
        aria-label={`Bring back ${template.name}`}
        title="Bring back to workout page"
      >
        <RotateCcw size={13} />
        <span className="hidden sm:inline">Bring back</span>
      </button>
    </div>
  );
}
