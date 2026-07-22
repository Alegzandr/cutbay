import type { DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store/store';
import type { TransitionType } from '../types';
import { EFFECTS, TRANSITIONS, type EffectGroup } from '../effects/catalog';
import { resolveEffectTargets } from '../effects/apply';
import { EFFECT_DRAG_MIME, TRANSITION_DRAG_MIME } from '../app/config';
import { useIsCoarsePointer } from '../lib/device';

/**
 * The Effects and Transitions panes of the media library. Both are catalogues
 * applied the way a desktop NLE applies them: double-click puts the entry on
 * the current selection, dragging puts it on the clip it lands on. The tiles
 * dim when the selection cannot take them, so a dead double-click is visible
 * before it is attempted rather than after.
 */

/**
 * Shared catalogue tile. Two input stories, because HTML5 drag does not exist
 * under a finger: with a mouse the tile is draggable and applies on
 * double-click (a single click must not fire an effect on the way into a drag);
 * on touch it is a plain button that applies on tap, since tapping is the only
 * gesture left. A dimmed tile stays draggable on desktop - the selection is not
 * the only possible target, the clip under the pointer is one too - but on
 * touch it is genuinely inert, so it is disabled rather than merely faint.
 */
function CatalogTile({
  label,
  enabled,
  coarse,
  onDragStart,
  onApply,
}: {
  label: string;
  enabled: boolean;
  coarse: boolean;
  onDragStart: (e: DragEvent) => void;
  onApply: () => void;
}) {
  return (
    <button
      type="button"
      draggable={!coarse}
      onDragStart={coarse ? undefined : onDragStart}
      onClick={coarse ? onApply : undefined}
      onDoubleClick={coarse ? undefined : onApply}
      disabled={coarse && !enabled}
      className={`touch-hit select-none rounded border border-zinc-800 bg-zinc-800/60 px-2 py-1.5 text-left text-2xs font-medium pointer-coarse:py-2.5 ${
        coarse ? '' : 'cursor-grab active:cursor-grabbing'
      } ${
        enabled
          ? 'text-zinc-200 hover:border-zinc-700 hover:bg-zinc-700/60 active:bg-zinc-700'
          : 'text-zinc-500 hover:bg-zinc-800'
      }`}
      title={label}
    >
      <span className="block truncate">{label}</span>
    </button>
  );
}

/** Section heading inside a catalogue pane. */
function GroupHeading({ children }: { children: string }) {
  return (
    <h3 className="px-0.5 pt-1 text-2xs font-semibold uppercase tracking-wide text-zinc-500">
      {children}
    </h3>
  );
}

function CatalogGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-1">{children}</div>
  );
}

/**
 * The line above a catalogue: it has to name the gesture that actually exists
 * on this device, since they do not overlap between mouse and touch.
 */
function CatalogHint() {
  const { t } = useTranslation();
  const coarse = useIsCoarsePointer();
  return (
    <p className="px-0.5 pb-1 text-2xs leading-snug text-zinc-500">
      {t(coarse ? 'library.catalog.hintTouch' : 'library.catalog.hint')}
    </p>
  );
}

/**
 * On touch the catalogue lives in a drawer covering the editor: leaving it open
 * after a tap would hide the very change the tap just made.
 */
function dismissOnTouch(coarse: boolean) {
  if (coarse) useStore.getState().setLibraryOpen(false);
}

export function EffectsPane() {
  const { t } = useTranslation();
  const coarse = useIsCoarsePointer();
  const project = useStore((s) => s.project);
  const assets = useStore((s) => s.assets);
  const selectedClipIds = useStore((s) => s.selectedClipIds);

  const apply = (effectId: string) => {
    const st = useStore.getState();
    if (selectedClipIds.length === 0) {
      st.setNotice(t('library.effects.noSelection'));
      return;
    }
    if (resolveEffectTargets(project, assets, effectId, selectedClipIds).length === 0) {
      st.setNotice(t('library.effects.rejected'));
      return;
    }
    st.applyEffectPreset(effectId, selectedClipIds);
    dismissOnTouch(coarse);
  };

  const groups: EffectGroup[] = ['video', 'audio'];
  return (
    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5">
      <CatalogHint />
      {groups.map((group) => (
        <div key={group} className="space-y-1">
          <GroupHeading>{t(`library.effects.${group}`)}</GroupHeading>
          <CatalogGrid>
            {EFFECTS.filter((fx) => fx.group === group).map((fx) => (
              <CatalogTile
                key={fx.id}
                label={t(fx.labelKey)}
                coarse={coarse}
                enabled={
                  selectedClipIds.length > 0 &&
                  resolveEffectTargets(project, assets, fx.id, selectedClipIds).length > 0
                }
                onDragStart={(e) => {
                  e.dataTransfer.setData(EFFECT_DRAG_MIME, fx.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onApply={() => apply(fx.id)}
              />
            ))}
          </CatalogGrid>
        </div>
      ))}
    </div>
  );
}

export function TransitionsPane() {
  const { t } = useTranslation();
  const coarse = useIsCoarsePointer();
  const selectedClipIds = useStore((s) => s.selectedClipIds);

  const apply = (type: TransitionType) => {
    const st = useStore.getState();
    if (selectedClipIds.length === 0) {
      st.setNotice(t('library.effects.noSelection'));
      return;
    }
    // A transition needs something to come out of. When no selected clip has a
    // usable predecessor, say so - the drop is otherwise a silent no-op.
    const applied = selectedClipIds.filter((id) => st.applyTransition(id, type));
    if (applied.length === 0) {
      st.setNotice(t('library.transitions.rejected'));
      return;
    }
    dismissOnTouch(coarse);
  };

  return (
    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5">
      <CatalogHint />
      <CatalogGrid>
        {TRANSITIONS.map((type) => (
          <CatalogTile
            key={type}
            label={t(`inspector.transition.${type}`)}
            coarse={coarse}
            enabled={selectedClipIds.length > 0}
            onDragStart={(e) => {
              e.dataTransfer.setData(TRANSITION_DRAG_MIME, type);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onApply={() => apply(type)}
          />
        ))}
      </CatalogGrid>
    </div>
  );
}
