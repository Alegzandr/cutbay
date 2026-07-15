import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/store';
import { Tooltip } from '../../ui/Tooltip';
import { ToggleButton } from '../../ui/ToggleButton';
import { ClipText, TextClip } from '../../types';
import { SliderRow } from '../SliderRow';
import { pct } from '../format';

export function TextSection({ clip }: { clip: TextClip }) {
  const { t } = useTranslation();
  const { updateClip, beginGesture, endGesture } = useStore.getState();
  const text = clip.text;
  const setText = (patch: Partial<ClipText>) =>
    updateClip(clip.id, { text: { ...text, ...patch } });

  return (
    <div className="space-y-3">
      <textarea
        value={text.content}
        rows={2}
        placeholder={t('inspector.textPlaceholder')}
        className="w-full resize-y rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-500"
        onFocus={beginGesture}
        onBlur={endGesture}
        onChange={(e) => setText({ content: e.target.value })}
      />
      <div className="flex items-center gap-3 text-xs text-zinc-400">
        <span className="w-16 flex-none">{t('inspector.style')}</span>
        <Tooltip label={t('inspector.textColor')}>
          <input
            type="color"
            value={text.color}
            className="h-7 w-10 flex-none cursor-pointer rounded border border-zinc-700 bg-zinc-800"
            onFocus={beginGesture}
            onBlur={endGesture}
            onChange={(e) => setText({ color: e.target.value })}
          />
        </Tooltip>
        <Tooltip label={t('inspector.bold')}>
          <ToggleButton
            className="font-bold"
            active={!!text.bold}
            onClick={() => useStore.getState().updateClipCommitted(clip.id, { text: { ...text, bold: !text.bold } })}
          >
            {/* The glyph itself is localised: "B" in English, "G" (gras) in French. */}
            {t('inspector.bold.short')}
          </ToggleButton>
        </Tooltip>
        <Tooltip label={t('inspector.outline.hint')}>
          <ToggleButton
            active={!!text.outline}
            onClick={() => useStore.getState().updateClipCommitted(clip.id, { text: { ...text, outline: !text.outline } })}
          >
            {t('inspector.outline')}
          </ToggleButton>
        </Tooltip>
        <Tooltip label={t('inspector.box.hint')}>
          <ToggleButton
            active={!!text.background}
            onClick={() => useStore.getState().updateClipCommitted(clip.id, { text: { ...text, background: !text.background } })}
          >
            {t('inspector.box')}
          </ToggleButton>
        </Tooltip>
      </div>
      <SliderRow
        label={t('inspector.size')}
        value={text.sizeFrac}
        min={0.02}
        max={0.3}
        step={0.005}
        format={pct}
        onChange={(v) => setText({ sizeFrac: v })}
      />
    </div>
  );
}
