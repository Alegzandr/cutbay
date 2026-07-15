import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/store';
import { Clip, ClipTransform } from '../../types';
import { DEFAULT_TRANSFORM } from '../../model';
import { SliderRow } from '../SliderRow';
import { pct } from '../format';

export function CropSection({ clip }: { clip: Clip }) {
  const { t } = useTranslation();
  const { updateClip } = useStore.getState();
  const tf: ClipTransform = clip.transform ?? DEFAULT_TRANSFORM;
  const setCrop = (patch: Partial<ClipTransform['crop']>) =>
    updateClip(clip.id, { transform: { ...tf, crop: { ...tf.crop, ...patch } } });

  return (
    <>
      <SliderRow label={t('inspector.cropLeft')} value={tf.crop.x} min={0} max={0.9} step={0.01} format={pct} onChange={(v) => setCrop({ x: v, w: Math.min(tf.crop.w, 1 - v) })} />
      <SliderRow label={t('inspector.cropTop')} value={tf.crop.y} min={0} max={0.9} step={0.01} format={pct} onChange={(v) => setCrop({ y: v, h: Math.min(tf.crop.h, 1 - v) })} />
      <SliderRow label={t('inspector.cropWidth')} value={tf.crop.w} min={0.05} max={1} step={0.01} format={pct} onChange={(v) => setCrop({ w: Math.min(v, 1 - tf.crop.x) })} />
      <SliderRow label={t('inspector.cropHeight')} value={tf.crop.h} min={0.05} max={1} step={0.01} format={pct} onChange={(v) => setCrop({ h: Math.min(v, 1 - tf.crop.y) })} />
    </>
  );
}
