import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Copy, Scissors, SlidersHorizontal, Trash2, ZoomIn } from 'lucide-react';
import { useStore, getSelectedClip } from '../store/store';
import { useIsCoarsePointer } from '../lib/device';

/** Mobile contextual toolbar (CapCut-style): appears when a clip is selected. */
export function ClipActionBar() {
  const { t } = useTranslation();
  const coarse = useIsCoarsePointer();
  const clip = useStore(getSelectedClip);
  const inspectorOpen = useStore((s) => s.inspectorOpen);
  const show = coarse && clip !== null && !inspectorOpen;

  const item =
    'flex min-w-14 flex-col items-center gap-1 rounded-lg px-3 py-1.5 text-[10px] text-zinc-300 active:bg-zinc-800';

  return (
    <AnimatePresence>
      {show && clip && (
        <motion.div
          initial={{ y: '110%' }}
          animate={{ y: 0 }}
          exit={{ y: '110%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 380 }}
          className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-zinc-800 bg-zinc-900/95 px-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur"
        >
          <button className={item} onClick={() => useStore.getState().splitAtPlayhead()}>
            <Scissors className="h-5 w-5" />
            {t('clipbar.split')}
          </button>
          <button className={item} onClick={() => useStore.getState().duplicateClip(clip.id)}>
            <Copy className="h-5 w-5" />
            {t('clipbar.duplicate')}
          </button>
          {/* Punch-in: cycle 100 % → 120 % → 140 % → 100 % (the social-cut zoom). */}
          <button className={item} onClick={() => useStore.getState().punchZoomSelected()}>
            <ZoomIn className="h-5 w-5" />
            {t('clipbar.punchIn')}
          </button>
          <button className={item} onClick={() => useStore.getState().setInspectorOpen(true)}>
            <SlidersHorizontal className="h-5 w-5" />
            {t('clipbar.adjust')}
          </button>
          {/* CapCut semantics on touch: deleting a clip closes the gap it leaves. */}
          <button className={item} onClick={() => useStore.getState().rippleDeleteClip(clip.id)}>
            <Trash2 className="h-5 w-5" />
            {t('clipbar.delete')}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
