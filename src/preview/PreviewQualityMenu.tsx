import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Gauge } from 'lucide-react';
import { useStore } from '../store/store';
import {
  PREVIEW_RESOLUTION_SCALE,
  type PreviewResolutionMode,
} from '../app/config';

const OPTIONS: readonly PreviewResolutionMode[] = ['auto', 'full', 'half', 'quarter', 'eighth'];

/** Short rung label from a render scale: "Full", "1/2", "1/4", "1/8". */
function scaleLabel(scale: number, fullLabel: string): string {
  return scale >= 1 ? fullLabel : `1/${Math.round(1 / scale)}`;
}

/** Label for one option in the list (Auto and Full are localized, fractions are numeric). */
function optionLabel(mode: PreviewResolutionMode, autoLabel: string, fullLabel: string): string {
  if (mode === 'auto') return autoLabel;
  return scaleLabel(PREVIEW_RESOLUTION_SCALE[mode], fullLabel);
}

/**
 * Playback-resolution picker, pinned to the monitor's bottom-right corner the
 * way Premiere / DaVinci Resolve surface theirs. Lowering the rung composites a
 * smaller frame (cheaper) that the browser upscales to fill the monitor;
 * **Auto** lets the engine pick the rung that keeps playback fluid on the
 * current machine and shows which one it settled on.
 */
export function PreviewQualityMenu() {
  const { t } = useTranslation();
  const mode = useStore((s) => s.previewResolution);
  const activeScale = useStore((s) => s.previewActiveScale);
  const { setPreviewResolution } = useStore.getState();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape while the list is open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const autoLabel = t('preview.quality.auto');
  const fullLabel = t('preview.quality.full');
  // Trigger text: fixed rungs show their rung; Auto shows the rung it settled on.
  const triggerLabel =
    mode === 'auto'
      ? `${autoLabel} · ${scaleLabel(activeScale, fullLabel)}`
      : scaleLabel(PREVIEW_RESOLUTION_SCALE[mode], fullLabel);

  return (
    <div ref={rootRef} className="absolute bottom-2 right-2 z-20">
      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 mb-1.5 w-40 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900/95 py-1 shadow-xl shadow-black/50 backdrop-blur"
        >
          {OPTIONS.map((opt) => (
            <button
              key={opt}
              role="menuitemradio"
              aria-checked={mode === opt}
              className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs ${
                mode === opt ? 'text-sky-300' : 'text-zinc-300 hover:bg-zinc-800'
              }`}
              onClick={() => {
                setPreviewResolution(opt);
                setOpen(false);
              }}
            >
              <Check className={`h-3.5 w-3.5 flex-none ${mode === opt ? '' : 'invisible'}`} />
              <span className="flex-1 tabular-nums">{optionLabel(opt, autoLabel, fullLabel)}</span>
              {opt === 'auto' && (
                <span className="text-[10px] text-zinc-500">{t('preview.quality.autoDesc')}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <button
        aria-label={t('preview.quality.title')}
        title={`${t('preview.quality.title')} — ${t('preview.quality.hint')}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-md border border-zinc-700/70 bg-zinc-900/70 px-2 py-1 text-[11px] font-medium tabular-nums backdrop-blur transition-colors hover:bg-zinc-800/80 ${
          open ? 'text-sky-300' : 'text-zinc-300'
        }`}
        onClick={() => setOpen((v) => !v)}
      >
        <Gauge className="h-3.5 w-3.5" />
        {triggerLabel}
      </button>
    </div>
  );
}
