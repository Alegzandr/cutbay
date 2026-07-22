import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useStore } from '../../store/store';
import { ToggleButton } from '../../ui/ToggleButton';
import { AudioFxType, Clip } from '../../types';
import { SliderRow } from '../SliderRow';
import { gainDb } from '../format';
import { DB_STEP_FADER, faderToGain, faderToGainStepped, gainToFader } from '../../lib/gain';
import { useVolumeEntry } from '../../ui/VolumeEntry';

export function AudioSection({ clip }: { clip: Clip }) {
  const { t } = useTranslation();
  const { updateClip, updateClipCommitted } = useStore.getState();
  const volumeEntry = useVolumeEntry({
    gain: clip.volume,
    onCommit: (volume) => updateClipCommitted(clip.id, { volume }),
  });

  const fxList = clip.audioFx ?? [];
  const removeFx = (type: AudioFxType) => {
    const next = fxList.filter((f) => f.type !== type);
    updateClipCommitted(clip.id, { audioFx: next.length ? next : undefined });
  };
  // Live (one undo per drag via SliderRow's begin/endGesture); the sameAudioMix
  // gate now watches audioFx, so the preview follows the change as it moves.
  const setFxAmount = (type: AudioFxType, amount: number) =>
    updateClip(clip.id, { audioFx: fxList.map((f) => (f.type === type ? { ...f, amount } : f)) });

  // Pan read-out: the letter is the localised initial of Center/Left/Right.
  const pan = (v: number) => {
    if (v === 0) return t('inspector.pan.center');
    const side = v < 0 ? t('inspector.pan.left') : t('inspector.pan.right');
    return `${side}${Math.round(Math.abs(v) * 100)}`;
  };

  return (
    <>
      {/* Volume rides a dB fader scale, not the raw linear gain: min/max/step
          here are fader positions, converted on both sides. The step is one
          whole dB; right-click opens the decimal entry. */}
      <SliderRow
        label={t('inspector.volume')}
        value={gainToFader(clip.volume)}
        min={0}
        max={1}
        step={DB_STEP_FADER}
        format={(p) => gainDb(faderToGain(p))}
        onChange={(p) => updateClip(clip.id, { volume: faderToGainStepped(p) })}
        onContextMenu={volumeEntry.onContextMenu}
      />
      {volumeEntry.entry}
      <SliderRow
        label={t('inspector.balance')}
        value={clip.pan ?? 0}
        min={-1}
        max={1}
        step={0.01}
        format={pan}
        onChange={(v) => updateClip(clip.id, { pan: v })}
      />
      <div className="flex items-center gap-3 text-xs text-zinc-400">
        <span className="w-16 flex-none">{t('inspector.channels')}</span>
        <ToggleButton
          active={!clip.mono}
          onClick={() => updateClipCommitted(clip.id, { mono: false })}
        >
          {t('inspector.stereo')}
        </ToggleButton>
        <ToggleButton
          active={!!clip.mono}
          onClick={() => updateClipCommitted(clip.id, { mono: true })}
        >
          {t('inspector.mono')}
        </ToggleButton>
      </div>

      {/* The effects this clip actually runs, each with its intensity and a way
          off. The roster of available effects lives in the library's Effects
          tab: listing it here too would say the same thing twice. */}
      <div className="space-y-2 border-t border-zinc-800 pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          {t('inspector.audioFx')}
        </h3>
        {fxList.length === 0 ? (
          <p className="text-2xs leading-snug text-zinc-500">{t('inspector.audioFx.empty')}</p>
        ) : (
          fxList.map((fx) => (
            <div key={fx.type} className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <SliderRow
                  label={t(`inspector.audioFx.${fx.type}`)}
                  value={fx.amount}
                  min={0}
                  max={1}
                  step={0.01}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => setFxAmount(fx.type, v)}
                />
              </div>
              <button
                type="button"
                className="touch-hit flex-none rounded p-1 text-zinc-500 hover:bg-zinc-800/70 hover:text-zinc-300 active:bg-zinc-800 pointer-coarse:p-2"
                onClick={() => removeFx(fx.type)}
                aria-label={t('inspector.audioFx.remove', {
                  name: t(`inspector.audioFx.${fx.type}`),
                })}
                title={t('inspector.audioFx.remove', {
                  name: t(`inspector.audioFx.${fx.type}`),
                })}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>
    </>
  );
}
