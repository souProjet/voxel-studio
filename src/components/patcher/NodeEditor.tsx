import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Maximize2, Minus, Plus, Sparkles, X, type LucideIcon } from 'lucide-react';
import type { ChannelKey, Generator, GeneratorKind, ModTarget, ModulationRoute, NodePos, PatchLayout, SensorNode } from '../../types/voxel';
import { useVoxel, useVoxelActions } from '../../state/useVoxelStore';
import { useDeleteCommands } from '../../state/useDeleteCommands';
import { KIND_META, SHADER_PRESETS, TARGET_META } from '../../services/catalog';
import { clamp, routeOutput } from '../../services/shaderMath';
import { sensorIdOf } from '../../services/sensors';
import { GENERATOR_META } from '../../services/generators';
import { KIND_ICON } from '../ui/sensorIcons';
import { SliderBar } from '../ui/primitives';
import { t } from '../../i18n';
import { chLabel, colorOf, GEN_ICON, TARGETS, type Patch } from './patchModel';

/* Node geometry, in graph units. Port positions derive from it, so no DOM measuring is needed. */
const NODE_W = 220;
const HEAD = 36;
const ROW = 24;
const PAD = 8;
const GRID = 8;
const EFFECT = '__effect';
const SNAP_PX = 24;
const EXTRA: Record<GeneratorKind, number> = { lfo: 46, envelope: 46, osc: 46, midi: 46, macro: 32 };
const GEN_KINDS = Object.keys(GENERATOR_META) as GeneratorKind[];

/** An output port carries a channel key; an input port is `target:<ModTarget>` or `trigger:<generator id>`. */
interface Row {
  key: string;
  dir: 'out' | 'in';
  label: string;
  detail?: string;
  spatial?: boolean;
}
interface NodeModel {
  id: string;
  title: string;
  subtitle: string;
  color: string;
  Icon: LucideIcon;
  rows: Row[];
  extra: number;
  gen?: Generator;
  dim?: boolean;
}
interface View {
  x: number;
  y: number;
  k: number;
}
type Snap = { kind: 'target'; target: ModTarget; at: NodePos } | { kind: 'trigger'; gen: string; at: NodePos } | { kind: 'amount'; route: string; at: NodePos };
type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { kind: 'node'; id: string; ox: number; oy: number; at: NodePos; moved: boolean }
  | { kind: 'wire'; from: ChannelKey; at: NodePos; snap: Snap | null; reroute?: { route?: string; trigger?: string } }
  | { kind: 'amount'; route: string; sy: number; start: number };

/** Camera kept across view switches. */
let savedView: View | null = null;

const nodeHeight = (n: NodeModel) => HEAD + n.rows.length * ROW + n.extra + PAD;
const wirePath = (a: NodePos, b: NodePos) => {
  const dx = Math.max(48, Math.abs(b.x - a.x) * 0.5);
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
};
/** Point at t = 0.5 on the wire's cubic Bezier. */
const wireMid = (a: NodePos, b: NodePos): NodePos => {
  const dx = Math.max(48, Math.abs(b.x - a.x) * 0.5);
  return { x: (a.x + 3 * (a.x + dx) + 3 * (b.x - dx) + b.x) / 8, y: (a.y + b.y) / 2 };
};
const snapGrid = (v: number) => Math.round(v / GRID) * GRID;

function buildNodes(patch: Patch, sensors: SensorNode[], generators: Generator[], shaderLabel: string): NodeModel[] {
  const nodes: NodeModel[] = sensors.map((s) => ({
    id: s.id,
    title: s.name,
    subtitle: t(KIND_META[s.kind].hardware),
    color: KIND_META[s.kind].color,
    Icon: KIND_ICON[s.kind],
    rows: patch.channels.filter((c) => c.sensorId === s.id).map((c) => ({ key: c.key, dir: 'out', label: chLabel(patch, c) })),
    extra: 0,
    dim: !s.enabled,
  }));
  for (const g of generators) {
    const rows: Row[] = [{ key: `${g.id}.out`, dir: 'out', label: t('Output') }];
    if (g.kind === 'envelope') rows.push({ key: `trigger:${g.id}`, dir: 'in', label: t('Trigger') });
    const detail =
      g.kind === 'lfo'
        ? `${g.shape.toUpperCase()} · ${g.tempoSync ? `${g.beats} ${t('beats')}` : `${g.rateHz.toFixed(2)} Hz`}`
        : g.kind === 'osc' || g.kind === 'midi'
          ? g.address || t('Not learned')
          : t(GENERATOR_META[g.kind].label);
    nodes.push({ id: g.id, title: g.name, subtitle: detail, color: GENERATOR_META[g.kind].color, Icon: GEN_ICON[g.kind], rows, extra: EXTRA[g.kind], gen: g, dim: !g.enabled });
  }
  nodes.push({
    id: EFFECT,
    title: t('Effect'),
    subtitle: shaderLabel,
    color: '#06b6d4',
    Icon: Sparkles,
    rows: TARGETS.map((tg) => ({ key: `target:${tg}`, dir: 'in', label: t(TARGET_META[tg].label), detail: t(TARGET_META[tg].detail), spatial: TARGET_META[tg].spatial })),
    extra: 0,
  });
  return nodes;
}

/** Saved positions win; new nodes stack under the sources, the effect node sits to their right. */
function resolveLayout(nodes: NodeModel[], saved: PatchLayout): Map<string, NodePos> {
  const pos = new Map<string, NodePos>();
  let bottom = -24;
  for (const n of nodes) {
    const p = saved[n.id];
    if (!p) continue;
    pos.set(n.id, p);
    if (n.id !== EFFECT) bottom = Math.max(bottom, p.y + nodeHeight(n));
  }
  for (const n of nodes) {
    if (pos.has(n.id)) continue;
    if (n.id === EFFECT) {
      pos.set(n.id, { x: NODE_W + 380, y: 0 });
      continue;
    }
    pos.set(n.id, { x: 0, y: bottom + 24 });
    bottom += 24 + nodeHeight(n);
  }
  return pos;
}

/** Rolling trace of a generator's output, drawn on a canvas so it costs no React state. */
function Scope({ value, color, frame }: { value: number; color: string; frame: unknown }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const history = useRef<number[]>([]);
  useEffect(() => {
    const h = history.current;
    h.push(value);
    if (h.length > 120) h.shift();
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const { width: W, height: H } = ctx.canvas;
    const x = (i: number) => W - (h.length - 1 - i) * (W / 119);
    const y = (v: number) => H - 3 - v * (H - 6);
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    h.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.lineTo(W, H);
    ctx.lineTo(x(0), H);
    ctx.fillStyle = `${color}22`;
    ctx.fill();
  }, [value, color, frame]);
  return <canvas ref={ref} width={(NODE_W - 24) * 2} height={64} className="h-8 w-full rounded-[4px] bg-black/40" />;
}

function Port({ dir, color, value, active, snapped }: { dir: 'in' | 'out'; color: string; value: number; active: boolean; snapped: boolean }) {
  return (
    <span
      className={`absolute top-1/2 z-10 h-3 w-3 -translate-y-1/2 rounded-full border-2 transition-transform ${dir === 'out' ? '-right-[7px]' : '-left-[7px]'} ${
        snapped ? 'port-snap scale-150' : 'hover:scale-125'
      }`}
      style={
        {
          '--port': color,
          borderColor: color,
          background: active ? color : '#09090b',
          boxShadow: value > 0.02 ? `0 0 ${4 + value * 10}px ${color}` : undefined,
        } as CSSProperties
      }
    />
  );
}

function NodeCard({
  n,
  at,
  patch,
  selected,
  dragging,
  connected,
  snapKey,
  sums,
}: {
  n: NodeModel;
  at: NodePos;
  patch: Patch;
  selected: boolean;
  dragging: boolean;
  connected: Set<string>;
  snapKey: string | null;
  sums: Partial<Record<ModTarget, number>>;
}) {
  const { setMacro } = useVoxelActions();
  const g = n.gen;
  const genValue = g ? clamp(patch.values[`${g.id}.out`] ?? 0) : 0;
  return (
    <div
      data-node={n.id}
      className={`node-in absolute rounded-lg border bg-card/95 backdrop-blur-sm ${dragging ? 'cursor-grabbing shadow-2xl shadow-black/60' : 'cursor-grab shadow-lg shadow-black/40'} ${
        n.dim ? 'opacity-50' : ''
      }`}
      style={{
        width: NODE_W,
        height: nodeHeight(n),
        transform: `translate(${at.x}px, ${at.y}px)${dragging ? ' scale(1.02)' : ''}`,
        borderColor: selected ? n.color : '#27272a',
        boxShadow: selected ? `0 0 0 1px ${n.color}, 0 0 24px ${n.color}33` : undefined,
        zIndex: dragging ? 30 : selected ? 20 : 10,
      }}
    >
      <div className="flex h-[36px] items-center gap-2 rounded-t-lg border-b border-line px-2.5" style={{ background: `linear-gradient(90deg, ${n.color}26, transparent 70%)` }}>
        <n.Icon size={13} style={{ color: n.color }} className="shrink-0" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[11.5px] font-medium text-zinc-100">{n.title}</div>
          <div className="truncate font-mono text-[9px] text-zinc-500">{n.subtitle}</div>
        </div>
        {g && (
          <span className="tabular font-mono text-[10px]" style={{ color: n.color }}>
            {genValue.toFixed(2)}
          </span>
        )}
      </div>
      {n.rows.map((r) => {
        if (r.dir === 'out') {
          const v = clamp(patch.values[r.key] ?? 0);
          return (
            <div key={r.key} data-out={r.key} className="group relative flex h-[24px] cursor-crosshair items-center gap-2 pl-2.5 pr-4 hover:bg-white/[0.03]">
              <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">{r.label}</span>
              <span className="h-[3px] w-14 overflow-hidden rounded-full bg-line">
                <span className="block h-full rounded-full" style={{ width: `${v * 100}%`, background: n.color }} />
              </span>
              <span className="tabular w-7 text-right font-mono text-[9.5px] text-zinc-500">{v.toFixed(2)}</span>
              <Port dir="out" color={n.color} value={v} active={connected.has(r.key)} snapped={false} />
            </div>
          );
        }
        const target = r.key.startsWith('target:') ? (r.key.slice(7) as ModTarget) : null;
        const sum = target ? (sums[target] ?? 0) : 0;
        const live = Math.abs(sum) > 0.005;
        return (
          <div key={r.key} data-in={r.key} className="relative flex h-[24px] cursor-crosshair items-center gap-2 pl-4 pr-2.5 hover:bg-white/[0.03]">
            <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300" title={r.detail}>
              {r.label}
              {r.spatial && <span className="ml-1.5 rounded-[3px] bg-spatial/15 px-1 font-mono text-[8.5px] text-spatial">3D</span>}
            </span>
            {target && (
              <>
                <span className="relative h-[3px] w-12 overflow-hidden rounded-full bg-line">
                  <span
                    className="absolute top-0 h-full rounded-full bg-audio transition-[width,left] duration-75"
                    style={{ left: `${50 + Math.min(0, sum) * 50}%`, width: `${Math.min(50, Math.abs(sum) * 50)}%` }}
                  />
                </span>
                <span className={`tabular w-9 text-right font-mono text-[9.5px] ${live ? 'text-audio' : 'text-zinc-600'}`}>
                  {sum >= 0 ? '+' : ''}
                  {sum.toFixed(2)}
                </span>
              </>
            )}
            <Port dir="in" color={target ? '#06b6d4' : n.color} value={target ? Math.abs(sum) : 0} active={connected.has(r.key)} snapped={snapKey === r.key} />
          </div>
        );
      })}
      {g && g.kind === 'macro' && (
        <div data-nodrag className="px-3 pt-1.5">
          <SliderBar value={g.value} color={n.color} height="h-5" onChange={(v) => setMacro(g.id, v)} />
        </div>
      )}
      {g && g.kind !== 'macro' && (
        <div className="px-3 pt-1.5">
          <Scope value={genValue} color={n.color} frame={patch.values} />
        </div>
      )}
    </div>
  );
}

export function NodeEditor({
  patch,
  selectedRouteId,
  selectedNodeId,
  onSelectRoute,
  onSelectNode,
}: {
  patch: Patch;
  selectedRouteId: string | null;
  selectedNodeId: string | null;
  onSelectRoute: (id: string | null) => void;
  onSelectNode: (id: string | null) => void;
}) {
  const routes = useVoxel((s) => s.routes);
  const sensors = useVoxel((s) => s.sensors);
  const generators = useVoxel((s) => s.generators);
  const layout = useVoxel((s) => s.patchLayout);
  const shader = useVoxel((s) => s.shader);
  const { addRoute, updateRoute, removeRoute, updateGenerator, addGenerator, moveNodes } = useVoxelActions();
  const del = useDeleteCommands();
  const rootRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(() => savedView ?? { x: 40, y: 40, k: 1 });
  const needsFit = useRef(savedView === null);
  const [drag, setDragState] = useState<Drag | null>(null);
  // Pointer events can outrun renders: handlers read the latest drag from this ref, not from state.
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };
  const lastChip = useRef({ id: '', at: 0 });

  const shaderLabel = t(SHADER_PRESETS.find((p) => p.id === shader)?.label ?? '');
  const nodes = buildNodes(patch, sensors, generators, shaderLabel);
  const pos = resolveLayout(nodes, layout);
  if (drag?.kind === 'node') pos.set(drag.id, drag.at);

  /* Port positions and colors, in graph units. */
  const ports = new Map<string, NodePos & { color: string }>();
  for (const n of nodes) {
    const p = pos.get(n.id)!;
    n.rows.forEach((r, i) => ports.set(r.key, { x: r.dir === 'out' ? p.x + NODE_W : p.x, y: p.y + HEAD + i * ROW + ROW / 2, color: n.color }));
  }
  const sums: Partial<Record<ModTarget, number>> = {};
  const connected = new Set<string>();
  const wires = routes.flatMap((r) => {
    const a = ports.get(r.source);
    const b = ports.get(`target:${r.target}`);
    if (!a || !b) return [];
    if (r.enabled) sums[r.target] = (sums[r.target] ?? 0) + routeOutput(r, patch.values);
    connected.add(r.source).add(`target:${r.target}`);
    return [{ r, a, b, mid: wireMid(a, b) }];
  });
  for (const g of generators) if (g.trigger && ports.has(g.trigger)) connected.add(g.trigger).add(`trigger:${g.id}`);
  for (const r of routes) if (r.amountSource) connected.add(r.amountSource);

  // Keep the camera when switching views.
  useEffect(() => {
    savedView = view;
  }, [view]);

  const fitTo = (rect: DOMRect) => {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const n of nodes) {
      const p = pos.get(n.id)!;
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + NODE_W);
      y1 = Math.max(y1, p.y + nodeHeight(n));
    }
    const k = Math.min(1.15, Math.max(0.35, Math.min((rect.width - 96) / (x1 - x0), (rect.height - 120) / (y1 - y0))));
    setView({ k, x: rect.width / 2 - ((x0 + x1) / 2) * k, y: (rect.height - 40) / 2 - ((y0 + y1) / 2) * k + 20 });
  };
  const fit = () => rootRef.current && fitTo(rootRef.current.getBoundingClientRect());
  const fitRef = useRef(fitTo);
  useEffect(() => {
    fitRef.current = fitTo;
  });

  // Frame the graph the first time it gets a size.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !needsFit.current) return;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth < 50) return;
      fitRef.current(el.getBoundingClientRect());
      needsFit.current = false;
      ro.disconnect();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zoomAt = (cx: number, cy: number, factor: number) =>
    setView((v) => {
      const k = Math.min(2, Math.max(0.3, v.k * factor));
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });

  // Pinch or Ctrl+wheel zooms, a mouse wheel zooms, two-finger scroll pans. Needs a non-passive listener.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY));
      if (e.ctrlKey || e.metaKey || mouseWheel) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Delete or Backspace removes the selected wire or generator.
  const delRef = useRef<() => void>(() => {});
  useEffect(() => {
    delRef.current = () => {
      if (selectedRouteId) removeRoute(selectedRouteId);
      else if (selectedNodeId && generators.some((g) => g.id === selectedNodeId)) void del.generator(selectedNodeId);
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        delRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toGraph = (e: { clientX: number; clientY: number }): NodePos => {
    const r = rootRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k };
  };

  /** The closest input a wire from `from` may land on, within reach of the pointer. */
  const findSnap = (at: NodePos, from: ChannelKey, reroute: { route?: string; trigger?: string } | undefined): Snap | null => {
    const reach = SNAP_PX / view.k;
    let best: Snap | null = null;
    let bestD = reach;
    const consider = (s: Snap) => {
      const d = Math.hypot(s.at.x - at.x, s.at.y - at.y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    };
    if (!reroute?.trigger) for (const tg of TARGETS) consider({ kind: 'target', target: tg, at: ports.get(`target:${tg}`)! });
    if (!reroute?.route)
      for (const g of generators) if (g.kind === 'envelope' && g.id !== sensorIdOf(from)) consider({ kind: 'trigger', gen: g.id, at: ports.get(`trigger:${g.id}`)! });
    if (!reroute) for (const w of wires) if (w.r.source !== from) consider({ kind: 'amount', route: w.r.id, at: w.mid });
    return best;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    const el = (e.target as Element).closest<HTMLElement>('[data-nodrag],[data-out],[data-in],[data-chip],[data-node]');
    if (el?.dataset.nodrag !== undefined) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const g = toGraph(e);
    if (e.button === 1 || !el) {
      setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false });
    } else if (el.dataset.out) {
      setDrag({ kind: 'wire', from: el.dataset.out, at: g, snap: null });
    } else if (el.dataset.in) {
      // Grabbing a connected input picks the wire up, so it can be moved or dropped to disconnect.
      const key = el.dataset.in;
      if (key.startsWith('target:')) {
        const onTarget = routes.filter((r) => `target:${r.target}` === key);
        const r = onTarget.find((x) => x.id === selectedRouteId) ?? onTarget[onTarget.length - 1];
        if (r) {
          onSelectRoute(r.id);
          setDrag({ kind: 'wire', from: r.source, at: g, snap: null, reroute: { route: r.id } });
        }
      } else {
        const gen = generators.find((x) => `trigger:${x.id}` === key);
        if (gen?.trigger) setDrag({ kind: 'wire', from: gen.trigger, at: g, snap: null, reroute: { trigger: gen.id } });
      }
    } else if (el.dataset.chip) {
      const r = routes.find((x) => x.id === el.dataset.chip);
      if (!r) return;
      // Pointer capture retargets the click events, so double-click is detected here.
      const last = lastChip.current;
      lastChip.current = { id: r.id, at: e.timeStamp };
      if (last.id === r.id && e.timeStamp - last.at < 300) {
        updateRoute(r.id, { enabled: !r.enabled });
        return;
      }
      onSelectRoute(r.id);
      setDrag({ kind: 'amount', route: r.id, sy: e.clientY, start: r.amount });
    } else if (el.dataset.node) {
      const id = el.dataset.node;
      const p = pos.get(id)!;
      onSelectNode(id);
      setDrag({ kind: 'node', id, ox: g.x - p.x, oy: g.y - p.y, at: p, moved: false });
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === 'pan') {
      const dx = e.clientX - drag.sx,
        dy = e.clientY - drag.sy;
      setView((v) => ({ ...v, x: drag.vx + dx, y: drag.vy + dy }));
      if (!drag.moved && Math.hypot(dx, dy) > 3) setDrag({ ...drag, moved: true });
    } else if (drag.kind === 'node') {
      const g = toGraph(e);
      const x = g.x - drag.ox,
        y = g.y - drag.oy;
      setDrag({ ...drag, at: e.altKey ? { x, y } : { x: snapGrid(x), y: snapGrid(y) }, moved: true });
    } else if (drag.kind === 'wire') {
      const at = toGraph(e);
      setDrag({ ...drag, at, snap: findSnap(at, drag.from, drag.reroute) });
    } else {
      const step = e.shiftKey ? 0.001 : 0.005;
      const amount = Math.round(clamp(drag.start - (e.clientY - drag.sy) * step, -1, 1) * 1000) / 1000;
      updateRoute(drag.route, { amount });
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    setDrag(null);
    if (!d) return;
    if (d.kind === 'pan' && !d.moved) {
      onSelectRoute(null);
      onSelectNode(null);
    } else if (d.kind === 'node' && d.moved) {
      // Saving every position freezes the automatic layout, so no other node reflows.
      moveNodes(Object.fromEntries(pos));
    } else if (d.kind === 'wire') {
      const { snap, from, reroute } = d;
      if (reroute?.route) {
        if (snap?.kind === 'target') updateRoute(reroute.route, { target: snap.target });
        else if (!snap) removeRoute(reroute.route);
      } else if (reroute?.trigger) {
        if (snap?.kind === 'trigger' && snap.gen !== reroute.trigger) {
          updateGenerator(reroute.trigger, { trigger: null });
          updateGenerator(snap.gen, { trigger: from });
        } else if (!snap) updateGenerator(reroute.trigger, { trigger: null });
      } else if (snap?.kind === 'target') {
        const existing = routes.find((r) => r.source === from && r.target === snap.target);
        if (existing) onSelectRoute(existing.id);
        else addRoute({ source: from, target: snap.target, curve: 'linear', amount: 0.5 });
      } else if (snap?.kind === 'trigger') {
        updateGenerator(snap.gen, { trigger: from });
        onSelectNode(snap.gen);
      } else if (snap?.kind === 'amount') {
        updateRoute(snap.route, { amountSource: from });
        onSelectRoute(snap.route);
      }
    }
  };

  const addAtCenter = (kind: GeneratorKind) => {
    const el = rootRef.current;
    if (!el) return;
    const c = toGraph({ clientX: el.getBoundingClientRect().left + el.clientWidth / 2, clientY: el.getBoundingClientRect().top + el.clientHeight / 2 });
    // Slide down to the first spot that overlaps no node.
    const at = { x: snapGrid(c.x - NODE_W / 2), y: snapGrid(c.y - 60) };
    const h = HEAD + ROW * (kind === 'envelope' ? 2 : 1) + EXTRA[kind] + PAD;
    const hits = () =>
      nodes.some((n) => {
        const p = pos.get(n.id)!;
        return at.x < p.x + NODE_W + 16 && p.x < at.x + NODE_W + 16 && at.y < p.y + nodeHeight(n) + 16 && p.y < at.y + h + 16;
      });
    while (hits()) at.y += GRID * 3;
    moveNodes(Object.fromEntries(pos));
    const id = addGenerator(kind, at);
    onSelectNode(id);
  };

  const wireDrag = drag?.kind === 'wire' ? drag : null;
  const pickedRoute = wireDrag?.reroute?.route;
  const pickedTrigger = wireDrag?.reroute?.trigger;
  const snapKey = wireDrag?.snap
    ? wireDrag.snap.kind === 'target'
      ? `target:${wireDrag.snap.target}`
      : wireDrag.snap.kind === 'trigger'
        ? `trigger:${wireDrag.snap.gen}`
        : null
    : null;

  return (
    <div
      ref={rootRef}
      className={`relative h-full w-full overflow-hidden bg-canvas ${drag?.kind === 'pan' && drag.moved ? 'cursor-grabbing' : ''} ${wireDrag ? 'cursor-crosshair' : ''}`}
      style={{
        backgroundImage: 'radial-gradient(circle, #232328 1px, transparent 1.2px)',
        backgroundSize: `${16 * view.k}px ${16 * view.k}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
    >
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
          {/* Envelope triggers */}
          {generators.map((g) => {
            const a = g.trigger ? ports.get(g.trigger) : undefined;
            const b = ports.get(`trigger:${g.id}`);
            if (!a || !b || g.id === pickedTrigger) return null;
            return (
              <g key={`trig-${g.id}`}>
                <path d={wirePath(a, b)} stroke={a.color} strokeOpacity={0.6} strokeWidth={1.5} fill="none" pathLength={1} className="wire-draw" />
                <path
                  d={wirePath(a, b)}
                  stroke={a.color}
                  strokeOpacity={0.4 + clamp(patch.values[g.trigger!] ?? 0) * 0.6}
                  strokeWidth={1.5}
                  fill="none"
                  strokeDasharray="2 10"
                  className="wire-flow"
                />
              </g>
            );
          })}
          {/* Routes */}
          {wires.map(({ r, a, b, mid }) => {
            if (r.id === pickedRoute) return null;
            const sel = r.id === selectedRouteId;
            const live = r.enabled ? Math.abs(routeOutput(r, patch.values)) : 0;
            const d = wirePath(a, b);
            const amt = r.amountSource ? ports.get(r.amountSource) : undefined;
            return (
              <g key={r.id} opacity={r.enabled ? 1 : 0.3}>
                {live > 0.02 && <path d={d} stroke={a.color} strokeOpacity={live * 0.22} strokeWidth={8} fill="none" strokeLinecap="round" />}
                <path d={d} stroke={a.color} strokeOpacity={sel ? 1 : 0.55} strokeWidth={sel ? 2.5 : 1.75} fill="none" pathLength={1} className="wire-draw" />
                {r.enabled && (
                  <path d={d} stroke="#fff" strokeOpacity={0.15 + live * 0.7} strokeWidth={1.5} fill="none" strokeDasharray="2 10" strokeLinecap="round" className="wire-flow" />
                )}
                {amt && <path d={wirePath(amt, mid)} stroke={amt.color} strokeOpacity={0.55} strokeWidth={1.25} fill="none" strokeDasharray="4 4" className="wire-flow" />}
              </g>
            );
          })}
          {/* Wire being dragged */}
          {wireDrag &&
            (() => {
              const a = ports.get(wireDrag.from);
              if (!a) return null;
              const end = wireDrag.snap?.at ?? wireDrag.at;
              const d = wirePath(a, end);
              return (
                <g>
                  <path d={d} stroke={a.color} strokeOpacity={0.3} strokeWidth={7} fill="none" strokeLinecap="round" />
                  <path d={d} stroke={a.color} strokeWidth={2} fill="none" strokeDasharray={wireDrag.snap ? undefined : '6 5'} className={wireDrag.snap ? '' : 'wire-flow'} />
                  <circle cx={end.x} cy={end.y} r={wireDrag.snap ? 6 : 4} fill={wireDrag.snap ? a.color : '#09090b'} stroke={a.color} strokeWidth={2} />
                </g>
              );
            })()}
        </svg>

        {nodes.map((n) => (
          <NodeCard
            key={n.id}
            n={n}
            at={pos.get(n.id)!}
            patch={patch}
            selected={n.id === selectedNodeId}
            dragging={drag?.kind === 'node' && drag.id === n.id && drag.moved}
            connected={connected}
            snapKey={snapKey}
            sums={sums}
          />
        ))}

        {/* Route chips: click selects, drag up or down sets the amount, double-click mutes */}
        {wires.map(({ r, a, mid }) => {
          if (r.id === pickedRoute) return null;
          const sel = r.id === selectedRouteId;
          const amountSnap = wireDrag?.snap?.kind === 'amount' && wireDrag.snap.route === r.id;
          return (
            <div
              key={r.id}
              data-chip={r.id}
              title={t('Drag up or down to set the amount, double-click to mute')}
              className={`absolute z-[5] flex h-[22px] -translate-x-1/2 -translate-y-1/2 cursor-ns-resize items-center gap-1 rounded-full border px-2 font-mono text-[10px] transition-[box-shadow,transform] ${
                sel ? 'bg-zinc-900 text-zinc-100' : 'bg-zinc-950/90 text-zinc-400 hover:text-zinc-200'
              } ${amountSnap ? 'scale-125' : ''}`}
              style={{
                left: mid.x,
                top: mid.y,
                borderColor: sel || amountSnap ? a.color : '#3f3f46',
                boxShadow: amountSnap ? `0 0 0 4px ${a.color}44` : sel ? `0 0 12px ${a.color}55` : undefined,
                opacity: r.enabled ? 1 : 0.55,
              }}
            >
              <span className="relative h-[3px] w-6 overflow-hidden rounded-full bg-line">
                <span className="absolute top-0 h-full" style={{ background: a.color, left: `${50 + Math.min(0, r.amount) * 50}%`, width: `${Math.abs(r.amount) * 50}%` }} />
              </span>
              <span className="tabular">
                {r.amount >= 0 ? '+' : ''}
                {r.amount.toFixed(2)}
              </span>
              <span className="text-[8.5px] text-zinc-500">{CURVE_TAG[r.curve]}</span>
              {r.amountSource && <span className="h-1.5 w-1.5 rounded-full" style={{ background: colorOf(patch, r.amountSource) }} title={t('Amount by')} />}
              {sel && (
                <button
                  type="button"
                  data-nodrag
                  onClick={() => removeRoute(r.id)}
                  title={t('Delete route')}
                  className="-mr-1 ml-0.5 grid h-4 w-4 place-items-center rounded-full text-zinc-500 hover:bg-red-500/20 hover:text-red-400"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      <div data-nodrag className="absolute left-3 top-3 flex items-center gap-1 rounded-lg border border-line bg-panel/90 p-1 shadow-lg backdrop-blur">
        {GEN_KINDS.map((k) => {
          const Icon = GEN_ICON[k];
          return (
            <button
              key={k}
              type="button"
              onClick={() => addAtCenter(k)}
              title={t('Add {name}: {description}', { name: t(GENERATOR_META[k].label), description: t(GENERATOR_META[k].description) })}
              className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-zinc-300 hover:bg-white/5 hover:text-zinc-100"
            >
              <Plus size={10} className="text-zinc-500" />
              <Icon size={12} style={{ color: GENERATOR_META[k].color }} />
              <span className="hidden xl:inline">{t(GENERATOR_META[k].label)}</span>
            </button>
          );
        })}
      </div>
      <div data-nodrag className="absolute right-3 top-3 flex items-center gap-0.5 rounded-lg border border-line bg-panel/90 p-1 shadow-lg backdrop-blur">
        <button
          type="button"
          title={t('Zoom out')}
          onClick={() => rootRef.current && zoomAt(rootRef.current.clientWidth / 2, rootRef.current.clientHeight / 2, 1 / 1.2)}
          className="grid h-7 w-7 place-items-center rounded-md text-zinc-400 hover:bg-white/5"
        >
          <Minus size={12} />
        </button>
        <span className="tabular w-10 text-center font-mono text-[10px] text-zinc-500">{Math.round(view.k * 100)}%</span>
        <button
          type="button"
          title={t('Zoom in')}
          onClick={() => rootRef.current && zoomAt(rootRef.current.clientWidth / 2, rootRef.current.clientHeight / 2, 1.2)}
          className="grid h-7 w-7 place-items-center rounded-md text-zinc-400 hover:bg-white/5"
        >
          <Plus size={12} />
        </button>
        <button type="button" title={t('Fit the graph')} onClick={fit} className="grid h-7 w-7 place-items-center rounded-md text-zinc-400 hover:bg-white/5">
          <Maximize2 size={12} />
        </button>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[10px] text-zinc-600">
        {wireDrag
          ? wireDrag.reroute
            ? t('Drop on an input to move the wire, anywhere else to disconnect it')
            : t('Drop on an effect input, an envelope trigger or a route chip')
          : t('Drag from an output to an input to connect · Drag a chip up or down for the amount · Scroll to pan, pinch or Cmd+scroll to zoom · Delete removes the selection')}
      </div>
    </div>
  );
}

const CURVE_TAG: Record<ModulationRoute['curve'], string> = { linear: 'LIN', exp: 'EXP', scurve: 'S', step: 'STEP' };
