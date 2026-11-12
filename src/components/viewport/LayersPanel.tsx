import { ArrowDown, ArrowUp, Code2, Eye, EyeOff, Layers, Trash } from 'lucide-react';
import type { BlendMode, EffectLayer } from '../../types/voxel';
import { useVoxel, useVoxelActions } from '../../state/useVoxelStore';
import { BLEND_MODES, parseParams, PRESETS, presetOf } from '../../services/layers';
import { ScrubInput } from '../ui/ScrubInput';
import { Field, IconButton, SectionHeader, Segmented, Select, TextInput } from '../ui/primitives';
import { t, tk } from '../../i18n';

const BLEND_LABEL: Record<BlendMode, string> = { normal: 'NORM', add: 'ADD', screen: 'SCRN', max: 'MAX', multiply: 'MULT' };
const BLEND_TITLE: Record<BlendMode, string> = {
  normal: tk('Normal: covers the layers below by its opacity'),
  add: tk('Add: sums light, brightens'),
  screen: tk('Screen: brightens without clipping as hard as add'),
  max: tk('Max: keeps the brightest channel'),
  multiply: tk('Multiply: darkens, use it as a mask'),
};
const LAYER_COLOR = '#a78bfa';

function LayerRow({ layer, index, count, selected, error }: { layer: EffectLayer; index: number; count: number; selected: boolean; error: boolean }) {
  const { selectLayer, updateLayer, moveLayer, removeLayer } = useVoxelActions();
  return (
    <div
      onClick={() => selectLayer(layer.id)}
      className={`group flex h-8 cursor-pointer items-center gap-1.5 border-l-2 pl-2 pr-1.5 ${selected ? 'border-l-[#a78bfa] bg-card' : 'border-l-transparent hover:bg-card/50'}`}
    >
      <button
        type="button"
        title={layer.enabled ? t('Hide layer') : t('Show layer')}
        onClick={(e) => {
          e.stopPropagation();
          updateLayer(layer.id, { enabled: !layer.enabled });
        }}
        className="grid h-5 w-5 place-items-center text-zinc-500 hover:text-zinc-200"
      >
        {layer.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
      </button>
      <span className={`min-w-0 flex-1 truncate text-[11.5px] ${layer.enabled ? 'text-zinc-200' : 'text-zinc-600'}`}>{layer.name}</span>
      {error && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" title={t('Shader error')} />}
      <span className="font-mono text-[9px] text-zinc-500">{BLEND_LABEL[layer.blend]}</span>
      <span className="tabular w-8 text-right font-mono text-[9.5px] text-zinc-400">{Math.round(layer.opacity * 100)}%</span>
      <span className={`flex items-center ${selected ? '' : 'invisible group-hover:visible'}`} onClick={(e) => e.stopPropagation()}>
        <span className={index === count - 1 ? 'pointer-events-none opacity-30' : ''}>
          <IconButton icon={ArrowUp} title={t('Move up')} onClick={() => moveLayer(layer.id, 1)} />
        </span>
        <span className={index === 0 ? 'pointer-events-none opacity-30' : ''}>
          <IconButton icon={ArrowDown} title={t('Move down')} onClick={() => moveLayer(layer.id, -1)} />
        </span>
        <IconButton icon={Trash} title={t('Delete layer and its routes')} danger onClick={() => removeLayer(layer.id)} />
      </span>
    </div>
  );
}

export function LayerDetail({ layer, error }: { layer: EffectLayer; error: string | undefined }) {
  const { updateLayer, setLayerParam, setLayerColor, setCodeOpen, loadPreset, setView } = useVoxelActions();
  const strips = useVoxel((s) => s.strips);
  const params = parseParams(layer.code);
  const preset = presetOf(layer);
  const toggleMask = (id: string) => updateLayer(layer.id, { mask: layer.mask.includes(id) ? layer.mask.filter((x) => x !== id) : [...layer.mask, id] });

  return (
    <div className="flex flex-col gap-1.5 border-t border-line p-3">
      <Field label={t('Name')}>
        <TextInput value={layer.name} onChange={(name) => updateLayer(layer.id, { name })} />
      </Field>
      <Field label={t('Shader')}>
        <div className="flex flex-1 items-center gap-1">
          <div className="min-w-0 flex-1">
            <Select
              value={preset?.id ?? ''}
              onChange={(id) => id && loadPreset(layer.id, id)}
              options={[...(preset ? [] : [{ value: '', label: t('Custom code') }]), ...PRESETS.map((p) => ({ value: p.id, label: t(p.label) }))]}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setCodeOpen(true);
              setView('studio');
            }}
            title={t('Edit the GLSL code')}
            className="flex h-6 shrink-0 items-center gap-1 rounded-[5px] border border-[#a78bfa]/50 px-2 font-mono text-[10px] text-[#c4b5fd] hover:bg-[#a78bfa]/10"
          >
            <Code2 size={11} /> GLSL
          </button>
        </div>
      </Field>
      {error && (
        <pre className="max-h-16 overflow-hidden whitespace-pre-wrap rounded-[5px] border border-red-500/40 bg-red-500/10 px-2 py-1 font-mono text-[10px] text-red-300">
          {error}
        </pre>
      )}
      <Field label={t('Blend')}>
        <div className="flex-1" title={t(BLEND_TITLE[layer.blend])}>
          <Segmented<BlendMode>
            mono
            accent={LAYER_COLOR}
            value={layer.blend}
            onChange={(blend) => updateLayer(layer.id, { blend })}
            options={BLEND_MODES.map((b) => ({ value: b, label: BLEND_LABEL[b] }))}
          />
        </div>
      </Field>
      <Field label={t('Opacity')}>
        <ScrubInput
          value={layer.opacity}
          onChange={(opacity) => updateLayer(layer.id, { opacity })}
          min={0}
          max={1}
          step={0.01}
          displayScale={100}
          unit="%"
          accent={LAYER_COLOR}
          className="flex-1"
        />
      </Field>
      <Field label={t('Segments')}>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          <button
            type="button"
            onClick={() => updateLayer(layer.id, { mask: [] })}
            className={`h-5 rounded-[4px] border px-1.5 text-[10px] ${layer.mask.length === 0 ? 'border-[#a78bfa]/60 text-[#c4b5fd]' : 'border-line text-zinc-500'}`}
          >
            {t('All')}
          </button>
          {strips.map((s) => (
            <button
              key={s.id}
              type="button"
              title={s.name}
              onClick={() => toggleMask(s.id)}
              className={`h-5 max-w-[120px] truncate rounded-[4px] border px-1.5 text-[10px] ${layer.mask.includes(s.id) ? 'border-[#a78bfa]/60 text-[#c4b5fd]' : 'border-line text-zinc-500'}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      </Field>
      {params.length > 0 && <div className="mt-1 text-[10px] uppercase tracking-wider text-zinc-500">{t('Parameters')}</div>}
      {params.map((p) =>
        p.kind === 'float' ? (
          <Field key={p.name} label={p.name}>
            <ScrubInput
              value={layer.params[p.name] ?? p.value}
              onChange={(v) => setLayerParam(layer.id, p.name, v)}
              min={p.min}
              max={p.max}
              step={Math.max(0.001, Number(((p.max - p.min) / 200).toPrecision(1)))}
              accent={LAYER_COLOR}
              className="flex-1"
            />
          </Field>
        ) : (
          <Field key={p.name} label={p.name}>
            <label className="flex h-6 flex-1 cursor-pointer items-center gap-2 rounded-[5px] border border-line bg-inset px-2">
              <span className="h-3.5 w-6 rounded-[3px]" style={{ background: layer.colors[p.name] ?? p.value }} />
              <span className="font-mono text-[10px] text-zinc-400">{layer.colors[p.name] ?? p.value}</span>
              <input type="color" className="sr-only" value={layer.colors[p.name] ?? p.value} onChange={(e) => setLayerColor(layer.id, p.name, e.target.value)} />
            </label>
          </Field>
        ),
      )}
    </div>
  );
}

/** The effect stack: layers render bottom to top, listed top first like an image editor. */
export function LayersPanel() {
  const layers = useVoxel((s) => s.layers);
  const selectedId = useVoxel((s) => s.selectedLayerId);
  const errors = useVoxel((s) => s.shaderErrors);
  const { addLayer } = useVoxelActions();
  const selected = layers.find((l) => l.id === selectedId) ?? null;
  return (
    <>
      <SectionHeader
        title={t('Layers')}
        icon={Layers}
        accent={LAYER_COLOR}
        right={
          <div className="w-[104px]">
            <Select
              value=""
              onChange={(id) => id && addLayer(id)}
              options={[{ value: '', label: t('+ Add layer') }, ...PRESETS.map((p) => ({ value: p.id, label: t(p.label) }))]}
            />
          </div>
        }
      />
      <div className="py-1">
        {layers.length === 0 && <p className="px-3 py-2 text-[11px] text-zinc-600">{t('No layer: the LEDs stay dark. Add one above.')}</p>}
        {[...layers].reverse().map((l) => (
          <LayerRow key={l.id} layer={l} index={layers.indexOf(l)} count={layers.length} selected={l.id === selected?.id} error={!!errors[l.id]} />
        ))}
      </div>
      {selected && <LayerDetail layer={selected} error={errors[selected.id]} />}
    </>
  );
}
