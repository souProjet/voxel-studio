import { useMemo, useState } from 'react';
import { Cable, Plus, Spline, Trash, Workflow } from 'lucide-react';
import type { ChannelKey, CurveType, ModTarget, ModulationRoute, SensorChannel, SensorNode } from '../../types/voxel';
import { useVoxel, useVoxelActions } from '../../state/useVoxelStore';
import { CURVES, KIND_META, TARGET_META } from '../../services/catalog';
import { clamp, routeOutput, shapeRouteInput, type ChannelValues } from '../../services/shaderMath';
import { allChannels, sensorIdOf } from '../../services/sensors';
import { ScrubInput } from '../ui/ScrubInput';
import { IconButton, SectionHeader, Segmented, Select, SliderBar, Toggle } from '../ui/primitives';

const TARGETS = Object.keys(TARGET_META) as ModTarget[];

/** Everything the patcher needs to resolve a channel key to a label, a color and a value. */
interface Patch {
  channels: SensorChannel[];
  byKey: Map<ChannelKey, SensorChannel>;
  sensors: Map<string, SensorNode>;
  values: ChannelValues;
}

const colorOf = (p: Patch, key: ChannelKey) => {
  const sensor = p.sensors.get(sensorIdOf(key));
  return sensor ? KIND_META[sensor.kind].color : '#52525b';
};
const labelOf = (p: Patch, key: ChannelKey) => {
  const c = p.byKey.get(key);
  const sensor = p.sensors.get(sensorIdOf(key));
  return c && sensor ? `${sensor.name} · ${c.label}` : 'Missing channel';
};

const G = { w: 820, nodeW: 196, nodeH: 40, srcX: 24, tgtX: 600, top: 18, gap: 50 };
const nodeY = (i: number) => G.top + i * G.gap;

function NodeGraph({
  routes,
  patch,
  selectedId,
  onSelect,
  onConnect,
}: {
  routes: ModulationRoute[];
  patch: Patch;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onConnect: (s: ChannelKey, t: ModTarget) => void;
}) {
  const [pending, setPending] = useState<ChannelKey | null>(null);
  const { channels, values } = patch;
  const targetSums = useMemo(() => {
    const sums: Partial<Record<ModTarget, number>> = {};
    for (const r of routes) sums[r.target] = (sums[r.target] ?? 0) + routeOutput(r, values);
    return sums;
  }, [routes, values]);
  const height = Math.max(channels.length, TARGETS.length) * G.gap + G.top + 24;
  const keys = channels.map((c) => c.key);

  return (
    <svg viewBox={`0 0 ${G.w} ${height}`} className="h-full w-full" preserveAspectRatio="xMidYMin meet">
      <defs>
        <pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="#1f1f23" />
        </pattern>
        <style>{`@keyframes flow { to { stroke-dashoffset: -24; } } .flow { animation: flow 0.8s linear infinite; }`}</style>
      </defs>
      <rect width={G.w} height={height} fill="url(#dots)" />

      {routes.map((r) => {
        const si = keys.indexOf(r.source);
        const ti = TARGETS.indexOf(r.target);
        if (si < 0) return null;
        const x1 = G.srcX + G.nodeW, y1 = nodeY(si) + G.nodeH / 2;
        const x2 = G.tgtX, y2 = nodeY(ti) + G.nodeH / 2;
        const mx = (x1 + x2) / 2;
        const d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
        const c = colorOf(patch, r.source);
        const sel = r.id === selectedId;
        const live = Math.abs(routeOutput(r, values));
        return (
          <g key={r.id} className="cursor-pointer" onClick={() => onSelect(r.id)} opacity={r.enabled ? 1 : 0.25}>
            <path d={d} stroke="transparent" strokeWidth={12} fill="none" />
            <path d={d} stroke={c} strokeOpacity={sel ? 0.9 : 0.35} strokeWidth={sel ? 2 : 1.25} fill="none" />
            <path d={d} stroke={c} strokeOpacity={0.25 + live * 0.75} strokeWidth={1.5} fill="none" strokeDasharray="3 9" className="flow" />
            <text x={mx} y={(y1 + y2) / 2 - 5} textAnchor="middle" fontSize={9} fontFamily="JetBrains Mono" fill={sel ? c : '#71717a'}>
              {r.amount >= 0 ? '+' : ''}
              {r.amount.toFixed(2)} {r.curve.toUpperCase()}
            </text>
          </g>
        );
      })}

      {channels.map((ch, i) => {
        const s = ch.key;
        const y = nodeY(i);
        const c = colorOf(patch, s);
        const v = clamp(values[s] ?? 0);
        const armed = pending === s;
        const sensor = patch.sensors.get(ch.sensorId);
        return (
          <g key={s} className="cursor-pointer" onClick={() => setPending(armed ? null : s)}>
            <rect x={G.srcX} y={y} width={G.nodeW} height={G.nodeH} rx={5} fill="#16161a" stroke={armed ? c : '#27272a'} />
            <rect x={G.srcX} y={y + 6} width={2} height={G.nodeH - 12} fill={c} />
            <text x={G.srcX + 12} y={y + 16} fontSize={11} fill="#e4e4e7" fontFamily="Inter">
              {ch.label}
            </text>
            <text x={G.srcX + 12} y={y + 30} fontSize={9} fill="#71717a" fontFamily="JetBrains Mono">
              {(sensor?.name ?? '').slice(0, 22)}
            </text>
            <rect x={G.srcX + G.nodeW - 52} y={y + 26} width={40} height={3} rx={1.5} fill="#27272a" />
            <rect x={G.srcX + G.nodeW - 52} y={y + 26} width={40 * v} height={3} rx={1.5} fill={c} />
            <text x={G.srcX + G.nodeW - 12} y={y + 17} fontSize={9} textAnchor="end" fill={c} fontFamily="JetBrains Mono">
              {v.toFixed(2)}
            </text>
            <circle cx={G.srcX + G.nodeW} cy={y + G.nodeH / 2} r={4} fill="#09090b" stroke={c} strokeWidth={1.5} />
          </g>
        );
      })}

      {TARGETS.map((t, i) => {
        const y = nodeY(i);
        const sum = targetSums[t] ?? 0;
        const meta = TARGET_META[t];
        return (
          <g
            key={t}
            className={pending ? 'cursor-crosshair' : ''}
            onClick={() => {
              if (!pending) return;
              onConnect(pending, t);
              setPending(null);
            }}
          >
            <rect x={G.tgtX} y={y} width={G.nodeW} height={G.nodeH} rx={5} fill="#16161a" stroke={pending ? '#3f3f46' : '#27272a'} strokeDasharray={pending ? '3 3' : undefined} />
            <circle cx={G.tgtX} cy={y + G.nodeH / 2} r={4} fill="#09090b" stroke="#06b6d4" strokeWidth={1.5} />
            <text x={G.tgtX + 12} y={y + 16} fontSize={11} fill="#e4e4e7" fontFamily="Inter">
              {meta.label}
            </text>
            <text x={G.tgtX + 12} y={y + 30} fontSize={9} fill={meta.spatial ? '#06b6d4' : '#71717a'} fontFamily="JetBrains Mono">
              {meta.spatial ? `3D · ${meta.detail}` : meta.detail}
            </text>
            <text x={G.tgtX + G.nodeW - 10} y={y + 17} fontSize={9} textAnchor="end" fill={Math.abs(sum) > 0.005 ? '#d946ef' : '#52525b'} fontFamily="JetBrains Mono">
              {sum >= 0 ? '+' : ''}
              {(sum * meta.range).toFixed(2)}
              {meta.unit && meta.unit !== '%' ? meta.unit : ''}
            </text>
          </g>
        );
      })}

      <text x={G.w / 2} y={height - 6} textAnchor="middle" fontSize={9} fill="#52525b" fontFamily="Inter">
        {pending ? `Pick a target for ${labelOf(patch, pending)}` : 'Click a source, then a target to patch a new route'}
      </text>
    </svg>
  );
}

const FORMULA: Record<CurveType, string> = {
  linear: 'y = x',
  exp: 'y = (e^4x − 1) / (e^4 − 1)',
  scurve: 'y = 3x² − 2x³',
  step: 'y = x ≥ 0.5 ? 1 : 0',
};

function ResponseCurve({ route, patch }: { route: ModulationRoute; patch: Patch }) {
  const W = 320, H = 220, P = 24;
  const x = clamp(patch.values[route.source] ?? 0);
  const y = routeOutput(route, patch.values);
  const px = (v: number) => P + v * (W - 2 * P);
  const py = (v: number) => H / 2 - v * (H / 2 - P);
  const pts: string[] = [];
  for (let i = 0; i <= 160; i++) {
    const t = i / 160;
    pts.push(`${px(t).toFixed(1)},${py(shapeRouteInput(route, t) * route.amount).toFixed(1)}`);
  }
  const c = colorOf(patch, route.source);
  const meta = TARGET_META[route.target];

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
        <text x={P} y={P - 8} fontSize={8} fill="#52525b" fontFamily="JetBrains Mono">+1</text>
        <text x={P} y={H - 8} fontSize={8} fill="#52525b" fontFamily="JetBrains Mono">−1</text>
        <text x={W - P} y={H - 8} fontSize={8} fill="#52525b" textAnchor="end" fontFamily="JetBrains Mono">IN 1.0</text>
        <polyline points={pts.join(' ')} fill="none" stroke={c} strokeWidth={1.75} strokeLinejoin="round" />
        <line x1={px(x)} x2={px(x)} y1={P} y2={H - P} stroke={c} strokeOpacity={0.35} strokeDasharray="2 3" />
        <line x1={P} x2={W - P} y1={py(y)} y2={py(y)} stroke={c} strokeOpacity={0.2} strokeDasharray="2 3" />
        <circle cx={px(x)} cy={py(y)} r={7} fill={c} opacity={0.7} filter="url(#glow)" />
        <circle cx={px(x)} cy={py(y)} r={3} fill="#fff" />
      </svg>
      <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
        <div className="rounded-[5px] border border-line bg-inset px-2 py-1.5">
          <div className="truncate text-zinc-500">IN · {labelOf(patch, route.source)}</div>
          <div className="text-[13px]" style={{ color: c }}>{x.toFixed(3)}</div>
        </div>
        <div className="rounded-[5px] border border-line bg-inset px-2 py-1.5">
          <div className="text-zinc-500">OUT · {meta.label}</div>
          <div className="text-[13px] text-audio">
            {y >= 0 ? '+' : ''}
            {(y * meta.range * (meta.unit === '%' ? 100 : 1)).toFixed(2)}
            <span className="ml-1 text-zinc-500">{meta.unit}</span>
          </div>
        </div>
      </div>
      <div className="rounded-[5px] border border-line bg-inset px-2 py-1.5 font-mono text-[10px] text-zinc-400">
        {FORMULA[route.curve]}
        {route.bipolar && <span className="text-zinc-500"> · x' = 2x − 1, y = sign(x')·f(|x'|)</span>}
        <span className="text-zinc-500"> · × {route.amount.toFixed(2)}</span>
      </div>
    </div>
  );
}

function MatrixRow({ route, patch, selected }: { route: ModulationRoute; patch: Patch; selected: boolean }) {
  const { updateRoute, removeRoute, selectRoute } = useVoxelActions();
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
      <Toggle checked={route.enabled} onChange={(enabled) => set({ enabled })} color={c} title="Enable route" />
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c }} />
        <Select value={route.source} onChange={(source) => set({ source })} options={patch.channels.map((ch) => ({ value: ch.key, label: labelOf(patch, ch.key) }))} />
      </div>
      <Select value={route.target} onChange={(target) => set({ target })} options={TARGETS.map((t) => ({ value: t, label: TARGET_META[t].spatial ? `${TARGET_META[t].label} (3D)` : TARGET_META[t].label }))} />
      <Segmented<CurveType> mono accent={c} value={route.curve} onChange={(curve) => set({ curve })} options={CURVES.map((cv) => ({ value: cv, label: cv === 'scurve' ? 'S-CRV' : cv.toUpperCase() }))} />
      <div className="flex items-center gap-1.5">
        <SliderBar value={route.amount} min={-1} max={1} bipolar color={c} onChange={(v) => set({ amount: Math.round(v * 100) / 100 })} />
        <ScrubInput value={route.amount} onChange={(amount) => set({ amount })} min={-1} max={1} step={0.01} className="w-[64px] shrink-0" accent={c} />
      </div>
      <div className="flex items-center gap-1.5">
        <Toggle checked={route.bipolar} onChange={(bipolar) => set({ bipolar })} color="#D946EF" title="Bipolar input" />
        <span className="font-mono text-[9px] text-zinc-500">BI</span>
      </div>
      <span className="tabular text-right font-mono text-[11px]" style={{ color: Math.abs(out) > 0.005 ? '#d946ef' : '#52525b' }}>
        {out >= 0 ? '+' : ''}
        {out.toFixed(2)}
      </span>
      <IconButton icon={Trash} title="Delete route" danger onClick={() => removeRoute(route.id)} />
    </div>
  );
}

export function ModulationView() {
  const routes = useVoxel((s) => s.routes);
  const sensors = useVoxel((s) => s.sensors);
  const values = useVoxel((s) => s.sensorValues);
  const structure = useMemo(() => {
    const channels = allChannels(sensors);
    return { channels, byKey: new Map(channels.map((c) => [c.key, c])), sensors: new Map(sensors.map((x) => [x.id, x])) };
  }, [sensors]);
  const patch: Patch = { ...structure, values };
  const selectedId = useVoxel((s) => s.selectedRouteId);
  const { selectRoute, addRoute } = useVoxelActions();
  const selected = routes.find((r) => r.id === selectedId) ?? routes[0] ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col border-r border-line">
          <SectionHeader title="Signal Graph" icon={Workflow} right={<span className="font-mono text-[10px] text-zinc-500">{routes.length} routes</span>} />
          <div className="min-h-0 flex-1 p-3">
            <NodeGraph
              routes={routes}
              patch={patch}
              selectedId={selected?.id ?? null}
              onSelect={selectRoute}
              onConnect={(source, target) => addRoute({ source, target, curve: 'linear', amount: 0.5 })}
            />
          </div>
        </section>
        <aside className="flex w-[360px] shrink-0 flex-col bg-panel">
          <SectionHeader title="Response Curve" icon={Spline} />
          <div className="p-3">
            {selected ? <ResponseCurve route={selected} patch={patch} /> : <p className="text-[11px] text-zinc-600">No route selected.</p>}
          </div>
        </aside>
      </div>
      <section className="flex max-h-[42%] shrink-0 flex-col border-t border-line bg-panel">
        <SectionHeader
          title="Modulation Matrix"
          icon={Cable}
          right={
            <button
              type="button"
              onClick={() => addRoute()}
              className="flex h-6 items-center gap-1 rounded-[5px] border border-line px-2 text-[10px] text-zinc-300 hover:border-line-hi"
            >
              <Plus size={11} /> Route
            </button>
          }
        />
        <div className="grid grid-cols-[28px_minmax(130px,1fr)_minmax(130px,1fr)_220px_minmax(200px,1.4fr)_64px_56px_28px] gap-1.5 border-b border-line px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
          <span>On</span>
          <span>Source</span>
          <span>Destination</span>
          <span>Curve</span>
          <span>Amount −1 … +1</span>
          <span>Mode</span>
          <span className="text-right">Out</span>
          <span />
        </div>
        <div className="min-h-0 overflow-y-auto">
          {routes.map((r) => (
            <MatrixRow key={r.id} route={r} patch={patch} selected={r.id === selected?.id} />
          ))}
        </div>
      </section>
    </div>
  );
}
