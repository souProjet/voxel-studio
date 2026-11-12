import { useEffect, useMemo, useRef, useState } from 'react';
import { Cable, ChevronDown, Layers, Plus, SlidersHorizontal, Spline, Trash, Workflow } from 'lucide-react';
import type { CurveType, Generator, LfoShape, ModulationRoute, RouteTarget } from '../../types/voxel';
import { useVoxel, useVoxelActions } from '../../state/useVoxelStore';
import { useDeleteCommands } from '../../state/useDeleteCommands';
import { CURVES, TARGET_META, type TargetMeta } from '../../services/catalog';
import { layerInputs, OPACITY_KEY, resolveTarget } from '../../services/layers';
import { LayerDetail } from '../viewport/LayersPanel';
import { clamp, routeOutput, routeTransfer } from '../../services/shaderMath';
import { GENERATOR_META, LFO_SHAPES, modChannels } from '../../services/generators';
import { inputs, learnInput, OSC_PORT } from '../../services/inputs';
import { bridgeMode } from '../../services/tauriBridge';
import { ScrubInput } from '../ui/ScrubInput';
import { Field, IconButton, SectionHeader, Segmented, Select, SliderBar, TextInput, Toggle } from '../ui/primitives';
import { t, tk } from '../../i18n';

const MISSING_TARGET: TargetMeta = { label: tk('Missing target'), detail: '', range: 1, unit: '' };
import { NodeEditor } from './NodeEditor';
import { colorOf, GEN_ICON, labelOf, TARGETS, type Patch } from './patchModel';

const FORMULA: Record<CurveType, string> = {
  linear: 'y = x',
  exp: 'y = (e^4x − 1) / (e^4 − 1)',
  scurve: 'y = 3x² − 2x³',
  step: 'y = x ≥ 0.5 ? 1 : 0',
};

function ResponseCurve({ route, patch }: { route: ModulationRoute; patch: Patch }) {
  const W = 320,
    H = 220,
    P = 24;
  const x = clamp(patch.values[route.source] ?? 0);
  const y = routeOutput(route, patch.values);
  const px = (v: number) => P + v * (W - 2 * P);
  const py = (v: number) => H / 2 - v * (H / 2 - P);
  const pts: string[] = [];
  for (let i = 0; i <= 160; i++) {
    const u = i / 160;
    pts.push(`${px(u).toFixed(1)},${py(routeTransfer(route, u)).toFixed(1)}`);
  }
  const c = colorOf(patch, route.source);
  const layers = useVoxel((s) => s.layers);
  const meta = resolveTarget(route.target, layers) ?? MISSING_TARGET;

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-md border border-line bg-inset">
        <defs>
          <filter id="glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3.5" />
          </filter>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <line key={`v${g}`} x1={px(g)} x2={px(g)} y1={P} y2={H - P} stroke="#1f1f23" />
        ))}
        {[-1, -0.5, 0, 0.5, 1].map((g) => (
          <line key={`h${g}`} x1={P} x2={W - P} y1={py(g)} y2={py(g)} stroke={g === 0 ? '#3f3f46' : '#1f1f23'} />
        ))}
        <rect x={px(route.inMin)} y={P} width={Math.max(0, px(route.inMax) - px(route.inMin))} height={H - 2 * P} fill={c} opacity={0.05} />
        <text x={P} y={P - 8} fontSize={8} fill="#52525b" fontFamily="JetBrains Mono">
          +1
        </text>
        <text x={P} y={H - 8} fontSize={8} fill="#52525b" fontFamily="JetBrains Mono">
          −1
        </text>
        <text x={W - P} y={H - 8} fontSize={8} fill="#52525b" textAnchor="end" fontFamily="JetBrains Mono">
          {t('IN 1.0')}
        </text>
        <polyline points={pts.join(' ')} fill="none" stroke={c} strokeWidth={1.75} strokeLinejoin="round" />
        <line x1={px(x)} x2={px(x)} y1={P} y2={H - P} stroke={c} strokeOpacity={0.35} strokeDasharray="2 3" />
        <line x1={P} x2={W - P} y1={py(y)} y2={py(y)} stroke={c} strokeOpacity={0.2} strokeDasharray="2 3" />
        <circle cx={px(x)} cy={py(y)} r={7} fill={c} opacity={0.7} filter="url(#glow)" />
        <circle cx={px(x)} cy={py(y)} r={3} fill="#fff" />
      </svg>
      <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
        <div className="rounded-[5px] border border-line bg-inset px-2 py-1.5">
          <div className="truncate text-zinc-500">{t('IN · {source}', { source: labelOf(patch, route.source) })}</div>
          <div className="text-[13px]" style={{ color: c }}>
            {x.toFixed(3)}
          </div>
        </div>
        <div className="rounded-[5px] border border-line bg-inset px-2 py-1.5">
          <div className="truncate text-zinc-500">{t('OUT · {target}', { target: t(meta.label) })}</div>
          <div className="text-[13px] text-audio">
            {y >= 0 ? '+' : ''}
            {(y * meta.range * (meta.unit === '%' ? 100 : 1)).toFixed(2)}
            <span className="ml-1 text-zinc-500">{meta.unit}</span>
          </div>
        </div>
      </div>
      <div className="rounded-[5px] border border-line bg-inset px-2 py-1.5 font-mono text-[10px] text-zinc-400">
        {FORMULA[route.curve]}
        {(route.inMin > 0 || route.inMax < 1) && (
          <span className="text-zinc-500">
            {' · '}
            {t('x in [{min}, {max}]', { min: route.inMin.toFixed(2), max: route.inMax.toFixed(2) })}
          </span>
        )}
        {route.bipolar && <span className="text-zinc-500"> · x' = 2x − 1, y = sign(x')·f(|x'|)</span>}
        <span className="text-zinc-500"> · × {route.amount.toFixed(2)}</span>
        {route.amountSource && <span className="text-zinc-500"> × {labelOf(patch, route.amountSource)}</span>}
        {route.smoothMs > 0 && <span className="text-zinc-500"> · {t('slew {ms} ms', { ms: route.smoothMs.toFixed(0) })}</span>}
      </div>
    </div>
  );
}

function RouteSettings({ route, patch }: { route: ModulationRoute; patch: Patch }) {
  const { updateRoute } = useVoxelActions();
  const set = (p: Partial<ModulationRoute>) => updateRoute(route.id, p);
  const c = colorOf(patch, route.source);
  return (
    <div className="flex flex-col gap-1 px-3 pb-3">
      <Field label={t('Input')}>
        <ScrubInput label="MIN" value={route.inMin} onChange={(v) => set({ inMin: Math.min(v, route.inMax) })} min={0} max={1} step={0.01} accent={c} className="flex-1" />
        <ScrubInput label="MAX" value={route.inMax} onChange={(v) => set({ inMax: Math.max(v, route.inMin) })} min={0} max={1} step={0.01} accent={c} className="flex-1" />
      </Field>
      <Field label={t('Smoothing')}>
        <ScrubInput value={route.smoothMs} onChange={(smoothMs) => set({ smoothMs })} min={0} max={3000} step={1} unit="ms" accent={c} className="flex-1" />
      </Field>
      <Field label={t('Amount by')}>
        <Select
          value={route.amountSource ?? ''}
          onChange={(v) => set({ amountSource: v || null })}
          options={[
            { value: '', label: t('Fixed amount') },
            ...patch.channels.filter((ch) => ch.key !== route.source).map((ch) => ({ value: ch.key, label: labelOf(patch, ch.key) })),
          ]}
        />
      </Field>
      <p className="text-[10px] leading-snug text-zinc-600">
        {t('The route reacts only between MIN and MAX of its source. Smoothing slews the output; Amount by scales the depth with another channel (a macro, an LFO, a sensor).')}
      </p>
    </div>
  );
}

const SHAPE_LABEL: Record<LfoShape, string> = { sine: 'SIN', triangle: 'TRI', saw: 'SAW', square: 'SQR', random: 'RND' };

function GeneratorCard({ g, patch }: { g: Generator; patch: Patch }) {
  const { updateGenerator, setMacro } = useVoxelActions();
  const del = useDeleteCommands();
  const set = (p: Partial<Generator>) => updateGenerator(g.id, p);
  const meta = GENERATOR_META[g.kind];
  const Icon = GEN_ICON[g.kind];
  const v = clamp(patch.values[`${g.id}.out`] ?? 0);
  const [learning, setLearning] = useState(false);
  const cancelLearn = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelLearn.current?.(), []);
  const toggleLearn = () => {
    if (learning) {
      cancelLearn.current?.();
      setLearning(false);
      return;
    }
    setLearning(true);
    if (g.kind !== 'osc' && g.kind !== 'midi') return;
    cancelLearn.current = learnInput(g.kind, (address) => {
      set({ address });
      setLearning(false);
    });
  };

  return (
    <div className="flex flex-col gap-1 border-b border-line px-3 py-2">
      <div className="flex items-center gap-1.5">
        <Icon size={12} style={{ color: meta.color }} className="shrink-0" />
        <input value={g.name} onChange={(e) => set({ name: e.target.value })} spellCheck={false} className="min-w-0 flex-1 bg-transparent text-[12px] text-zinc-100 outline-none" />
        <span className="tabular w-9 text-right font-mono text-[10px]" style={{ color: meta.color }}>
          {v.toFixed(2)}
        </span>
        <Toggle checked={g.enabled} onChange={(enabled) => set({ enabled })} color={meta.color} title={t('Enable generator')} />
        <IconButton icon={Trash} title={t('Delete generator and its routes')} danger onClick={() => void del.generator(g.id)} />
      </div>
      <div className="h-[3px] overflow-hidden rounded-full bg-line">
        <div className="h-full" style={{ width: `${v * 100}%`, background: meta.color }} />
      </div>

      {g.kind === 'lfo' && (
        <>
          <Segmented<LfoShape>
            mono
            accent={meta.color}
            value={g.shape}
            onChange={(shape) => set({ shape })}
            options={LFO_SHAPES.map((s) => ({ value: s, label: SHAPE_LABEL[s] }))}
          />
          <Field label={g.tempoSync ? t('Period') : t('Rate')}>
            {g.tempoSync ? (
              <ScrubInput value={g.beats} onChange={(beats) => set({ beats })} min={0.25} max={64} step={0.25} unit={t('beats')} accent={meta.color} className="flex-1" />
            ) : (
              <ScrubInput value={g.rateHz} onChange={(rateHz) => set({ rateHz })} min={0.01} max={20} step={0.01} unit="Hz" accent={meta.color} className="flex-1" />
            )}
            <Toggle checked={g.tempoSync} onChange={(tempoSync) => set({ tempoSync })} color="#D946EF" title={t('Lock to the effect tempo')} />
            <span className="font-mono text-[9px] text-zinc-500">BPM</span>
          </Field>
          <Field label="Phase">
            <ScrubInput value={g.phase} onChange={(phase) => set({ phase })} min={0} max={1} step={0.01} unit="cycle" accent={meta.color} className="flex-1" />
          </Field>
        </>
      )}

      {g.kind === 'envelope' && (
        <>
          <Field label={t('Trigger')}>
            <Select
              value={g.trigger ?? ''}
              onChange={(trigger) => set({ trigger: trigger || null })}
              options={[{ value: '', label: t('None') }, ...patch.channels.filter((ch) => ch.sensorId !== g.id).map((ch) => ({ value: ch.key, label: labelOf(patch, ch.key) }))]}
            />
          </Field>
          <Field label={t('Threshold')}>
            <ScrubInput value={g.threshold} onChange={(threshold) => set({ threshold })} min={0} max={1} step={0.01} accent={meta.color} className="flex-1" />
          </Field>
          <div className="grid grid-cols-4 gap-1">
            <ScrubInput label="A" value={g.attackMs} onChange={(attackMs) => set({ attackMs })} min={1} max={5000} step={1} accent={meta.color} />
            <ScrubInput label="D" value={g.decayMs} onChange={(decayMs) => set({ decayMs })} min={1} max={5000} step={1} accent={meta.color} />
            <ScrubInput label="S" value={g.sustain} onChange={(sustain) => set({ sustain })} min={0} max={1} step={0.01} accent={meta.color} />
            <ScrubInput label="R" value={g.releaseMs} onChange={(releaseMs) => set({ releaseMs })} min={1} max={10000} step={1} accent={meta.color} />
          </div>
        </>
      )}

      {g.kind === 'macro' && <SliderBar value={g.value} color={meta.color} onChange={(value) => setMacro(g.id, value)} />}

      {(g.kind === 'osc' || g.kind === 'midi') && (
        <>
          <Field label={g.kind === 'osc' ? t('Address') : t('Control')}>
            <TextInput mono value={g.address} onChange={(address) => set({ address: address.trim() })} placeholder={g.kind === 'osc' ? '/fader/1' : 'cc/1/74'} />
            <button
              type="button"
              onClick={toggleLearn}
              disabled={bridgeMode !== 'native'}
              className={`h-6 shrink-0 rounded-[5px] border px-2 font-mono text-[10px] disabled:opacity-40 ${learning ? 'animate-pulse border-amber-400 text-amber-300' : 'border-line text-zinc-300'}`}
            >
              {learning ? t('LISTEN') : t('LEARN')}
            </button>
          </Field>
          <Field label={t('Range')}>
            <ScrubInput label="MIN" value={g.min} onChange={(min) => set({ min })} min={-10000} max={10000} step={0.01} accent={meta.color} className="flex-1" />
            <ScrubInput label="MAX" value={g.max} onChange={(max) => set({ max })} min={-10000} max={10000} step={0.01} accent={meta.color} className="flex-1" />
          </Field>
          <p className="text-[10px] leading-snug text-zinc-600">
            {g.kind === 'osc'
              ? bridgeMode !== 'native'
                ? t('OSC needs the desktop app: browsers cannot listen on UDP.')
                : (inputs.status.oscError ?? t('Listening on UDP {port}. LEARN takes the next address received.', { port: OSC_PORT }))
              : bridgeMode !== 'native'
                ? t('MIDI needs the desktop app (the macOS webview has no Web MIDI).')
                : (inputs.midiError ??
                  (inputs.midiPorts.length
                    ? t('Ports: {ports}. LEARN takes the next control moved.', { ports: inputs.midiPorts.join(', ') })
                    : t('No MIDI port found. Plug a controller; ports are rescanned every 2 s.')))}
          </p>
        </>
      )}
    </div>
  );
}

function MatrixRow({ route, patch, selected }: { route: ModulationRoute; patch: Patch; selected: boolean }) {
  const { updateRoute, removeRoute, selectRoute } = useVoxelActions();
  const layers = useVoxel((s) => s.layers);
  const set = (p: Partial<ModulationRoute>) => updateRoute(route.id, p);
  const out = routeOutput(route, patch.values);
  const c = colorOf(patch, route.source);
  return (
    <div
      onClick={() => selectRoute(route.id)}
      className={`grid grid-cols-[28px_minmax(130px,1fr)_minmax(130px,1fr)_220px_minmax(200px,1.4fr)_64px_56px_28px] items-center gap-1.5 border-b border-line px-3 py-1.5 ${
        selected ? 'bg-card' : 'hover:bg-card/50'
      }`}
    >
      <Toggle checked={route.enabled} onChange={(enabled) => set({ enabled })} color={c} title={t('Enable route')} />
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c }} />
        <Select value={route.source} onChange={(source) => set({ source })} options={patch.channels.map((ch) => ({ value: ch.key, label: labelOf(patch, ch.key) }))} />
      </div>
      <Select
        value={route.target}
        onChange={(target) => set({ target })}
        options={[
          ...TARGETS.map((tg) => ({ value: tg as RouteTarget, label: TARGET_META[tg].spatial ? `${t(TARGET_META[tg].label)} (3D)` : t(TARGET_META[tg].label) })),
          ...layers.flatMap((l) => layerInputs(l).map((x) => ({ value: x.target, label: `${l.name} · ${x.key === OPACITY_KEY ? t('Opacity') : x.key}` }))),
          ...(resolveTarget(route.target, layers) ? [] : [{ value: route.target, label: t('Missing target') }]),
        ]}
      />
      <Segmented<CurveType>
        mono
        accent={c}
        value={route.curve}
        onChange={(curve) => set({ curve })}
        options={CURVES.map((cv) => ({ value: cv, label: cv === 'scurve' ? 'S-CRV' : cv.toUpperCase() }))}
      />
      <div className="flex items-center gap-1.5">
        <SliderBar value={route.amount} min={-1} max={1} bipolar color={c} onChange={(v) => set({ amount: Math.round(v * 100) / 100 })} />
        <ScrubInput value={route.amount} onChange={(amount) => set({ amount })} min={-1} max={1} step={0.01} className="w-[64px] shrink-0" accent={c} />
      </div>
      <div className="flex items-center gap-1.5">
        <Toggle checked={route.bipolar} onChange={(bipolar) => set({ bipolar })} color="#D946EF" title={t('Bipolar input')} />
        <span className="font-mono text-[9px] text-zinc-500">BI</span>
      </div>
      <span className="tabular text-right font-mono text-[11px]" style={{ color: Math.abs(out) > 0.005 ? '#d946ef' : '#52525b' }}>
        {out >= 0 ? '+' : ''}
        {out.toFixed(2)}
      </span>
      <IconButton icon={Trash} title={t('Delete route')} danger onClick={() => removeRoute(route.id)} />
    </div>
  );
}

export function ModulationView() {
  const routes = useVoxel((s) => s.routes);
  const sensors = useVoxel((s) => s.sensors);
  const generators = useVoxel((s) => s.generators);
  const values = useVoxel((s) => s.sensorValues);
  const structure = useMemo(() => {
    const channels = modChannels(sensors, generators);
    return {
      channels,
      byKey: new Map(channels.map((c) => [c.key, c])),
      sensors: new Map(sensors.map((x) => [x.id, x])),
      gens: new Map(generators.map((g) => [g.id, g])),
    };
  }, [sensors, generators]);
  const patch: Patch = { ...structure, values };
  const selectedId = useVoxel((s) => s.selectedRouteId);
  const { selectRoute, addRoute, selectLayer } = useVoxelActions();
  const layers = useVoxel((s) => s.layers);
  const shaderErrors = useVoxel((s) => s.shaderErrors);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [matrixOpen, setMatrixOpen] = useState(true);
  const selected = routes.find((r) => r.id === selectedId) ?? null;
  const selectedGen = !selected && nodeId ? (generators.find((g) => g.id === nodeId) ?? null) : null;
  const selectedLayer = !selected && nodeId ? (layers.find((l) => l.id === nodeId) ?? null) : null;
  const pickRoute = (id: string | null) => {
    selectRoute(id);
    if (id) setNodeId(null);
  };
  const pickNode = (id: string | null) => {
    setNodeId(id);
    if (id && layers.some((l) => l.id === id)) selectLayer(id);
    if (id) selectRoute(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col border-r border-line">
          <SectionHeader
            title={t('Signal Graph')}
            icon={Workflow}
            right={<span className="font-mono text-[10px] text-zinc-500">{routes.length === 1 ? t('1 route') : t('{n} routes', { n: routes.length })}</span>}
          />
          <div className="min-h-0 flex-1">
            <NodeEditor patch={patch} selectedRouteId={selected?.id ?? null} selectedNodeId={selected ? null : nodeId} onSelectRoute={pickRoute} onSelectNode={pickNode} />
          </div>
        </section>
        <aside className="flex w-[360px] shrink-0 flex-col overflow-y-auto bg-panel">
          {selected ? (
            <>
              <SectionHeader title={t('Response Curve')} icon={Spline} />
              <div className="p-3">
                <ResponseCurve route={selected} patch={patch} />
              </div>
              <SectionHeader title={t('Route')} icon={SlidersHorizontal} />
              <div className="pt-2">
                <RouteSettings route={selected} patch={patch} />
              </div>
            </>
          ) : selectedGen ? (
            <>
              <SectionHeader title={t(GENERATOR_META[selectedGen.kind].label)} icon={GEN_ICON[selectedGen.kind]} accent={GENERATOR_META[selectedGen.kind].color} />
              <GeneratorCard key={selectedGen.id} g={selectedGen} patch={patch} />
            </>
          ) : selectedLayer ? (
            <>
              <SectionHeader title={t('Layer')} icon={Layers} accent="#a78bfa" />
              <LayerDetail layer={selectedLayer} error={shaderErrors[selectedLayer.id]} />
            </>
          ) : (
            <>
              <SectionHeader title={t('Inspector')} icon={SlidersHorizontal} />
              <p className="px-3 py-3 text-[11px] leading-relaxed text-zinc-500">{t('Select a wire to shape its response, or a generator or a layer to edit it.')}</p>
            </>
          )}
        </aside>
      </div>
      <section className={`flex shrink-0 flex-col border-t border-line bg-panel ${matrixOpen ? 'max-h-[34%]' : ''}`}>
        <SectionHeader
          title={t('Modulation Matrix')}
          icon={Cable}
          right={
            <>
              <button
                type="button"
                onClick={() => addRoute()}
                className="flex h-6 items-center gap-1 rounded-[5px] border border-line px-2 text-[10px] text-zinc-300 hover:border-line-hi"
              >
                <Plus size={11} /> {t('Route')}
              </button>
              <IconButton icon={ChevronDown} title={matrixOpen ? t('Hide the matrix') : t('Show the matrix')} onClick={() => setMatrixOpen(!matrixOpen)} />
            </>
          }
        />
        {matrixOpen && (
          <>
            <div className="grid grid-cols-[28px_minmax(130px,1fr)_minmax(130px,1fr)_220px_minmax(200px,1.4fr)_64px_56px_28px] gap-1.5 border-b border-line px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
              <span>{t('On')}</span>
              <span>{t('Source')}</span>
              <span>{t('Destination')}</span>
              <span>{t('Curve')}</span>
              <span>{t('Amount −1 … +1')}</span>
              <span>{t('Mode')}</span>
              <span className="text-right">{t('Out')}</span>
              <span />
            </div>
            <div className="min-h-0 overflow-y-auto">
              {routes.map((r) => (
                <MatrixRow key={r.id} route={r} patch={patch} selected={r.id === selected?.id} />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
