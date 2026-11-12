import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Smartphone, Tablet, Zap } from 'lucide-react';
import type { EffectParams, ShaderId } from '../../types/voxel';
import { useVoxel, useVoxelActions, useVoxelStoreRef } from '../../state/useVoxelStore';
import { ROOM, SHADER_PRESETS } from '../../services/catalog';
import { runtime } from '../../services/engine';
import { Segmented } from '../ui/primitives';

type Form = 'tablet' | 'phone';

interface LivePreset {
  name: string;
  shader: ShaderId;
  params: Pick<EffectParams, 'radius' | 'speed' | 'hueShift'>;
  color: string;
}

const PRESETS: LivePreset[] = [
  { name: 'Pulse', shader: 'spherical_wave', params: { radius: 1.4, speed: 1, hueShift: 0 }, color: '#06B6D4' },
  { name: 'Plasma', shader: 'perlin_plasma', params: { radius: 1.8, speed: 0.8, hueShift: 0.3 }, color: '#D946EF' },
  { name: 'Laser', shader: 'laser_plane', params: { radius: 1, speed: 1.6, hueShift: 0 }, color: '#10B981' },
  { name: 'Ambient', shader: 'height_spectrum', params: { radius: 1.2, speed: 0.35, hueShift: 0.55 }, color: '#F59E0B' },
];

const HALF_W = ROOM.width / 2;
const HALF_D = ROOM.depth / 2;

/** Top-down XZ pad. Renders live LED colors and the effect cursor from the shared runtime. */
function SpatialPad() {
  const store = useVoxelStoreRef();
  const { setParams } = useVoxelActions();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(window.devicePixelRatio, 2);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w) return;
      if (canvas.width !== Math.round(w * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const toX = (x: number) => ((x + HALF_W) / ROOM.width) * w;
      const toY = (z: number) => ((z + HALF_D) / ROOM.depth) * h;

      ctx.fillStyle = '#050506';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#18181b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = -3; x <= 3; x++) {
        ctx.moveTo(toX(x), 0);
        ctx.lineTo(toX(x), h);
      }
      for (let z = -2; z <= 2; z++) {
        ctx.moveTo(0, toY(z));
        ctx.lineTo(w, toY(z));
      }
      ctx.stroke();

      const { layout, colors, params } = runtime;
      const pos = layout.positions;
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < layout.total; i++) {
        if (!layout.ranges[layout.rangeOf[i]].visible) continue;
        const k = i * 3;
        const r = Math.max(36, (colors[k] * 255) | 0);
        const g = Math.max(36, (colors[k + 1] * 255) | 0);
        const b = Math.max(40, (colors[k + 2] * 255) | 0);
        ctx.fillStyle = `rgba(${r},${g},${b},0.9)`;
        ctx.fillRect(toX(pos[k]) - 1.5, toY(pos[k + 2]) - 1.5, 3, 3);
      }
      ctx.globalCompositeOperation = 'source-over';

      const st = store.getState();
      const ox = toX(st.params.origin[0]);
      const oy = toY(st.params.origin[2]);
      const rad = (params.radius / ROOM.width) * w;
      ctx.strokeStyle = 'rgba(6,182,212,0.6)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(ox, oy, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(6,182,212,0.35)';
      ctx.beginPath();
      ctx.moveTo(ox, 0); ctx.lineTo(ox, h);
      ctx.moveTo(0, oy); ctx.lineTo(w, oy);
      ctx.stroke();
      ctx.fillStyle = '#06B6D4';
      ctx.beginPath();
      ctx.arc(ox, oy, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#09090B';
      ctx.beginPath();
      ctx.arc(ox, oy, 3, 0, Math.PI * 2);
      ctx.fill();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [store]);

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const tx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const tz = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const o = store.getState().params.origin;
    setParams({ origin: [+(tx * ROOM.width - HALF_W).toFixed(3), o[1], +(tz * ROOM.depth - HALF_D).toFixed(3)] });
  };

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full cursor-crosshair rounded-xl border border-line"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e);
      }}
    />
  );
}

function Fader({
  value,
  min = 0,
  max = 1,
  onChange,
  color,
  label,
  readout,
  vertical,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  color: string;
  label: string;
  readout: string;
  vertical?: boolean;
}) {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const set = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const k = vertical ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    onChange(min + Math.max(0, Math.min(1, k)) * (max - min));
  };
  return (
    <div className={`flex ${vertical ? 'h-full flex-col' : 'w-full flex-col'} items-center gap-1.5`}>
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <div
        className={`relative overflow-hidden rounded-xl border border-line bg-inset ${vertical ? 'w-14 flex-1' : 'h-12 w-full'}`}
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          set(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) set(e);
        }}
      >
        <div
          className="absolute"
          style={
            vertical
              ? { left: 0, right: 0, bottom: 0, height: `${t * 100}%`, background: `${color}33`, borderTop: `2px solid ${color}` }
              : { top: 0, bottom: 0, left: 0, width: `${t * 100}%`, background: `${color}33`, borderRight: `2px solid ${color}` }
          }
        />
      </div>
      <span className="tabular font-mono text-[11px]" style={{ color }}>
        {readout}
      </span>
    </div>
  );
}

function StrobeButton({ big }: { big?: boolean }) {
  const strobe = useVoxel((s) => s.manualStrobe);
  const { setManualStrobe } = useVoxelActions();
  return (
    <button
      type="button"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setManualStrobe(true);
      }}
      onPointerUp={() => setManualStrobe(false)}
      onPointerCancel={() => setManualStrobe(false)}
      className={`flex w-full items-center justify-center gap-2 rounded-xl border font-mono text-[12px] tracking-[0.2em] transition-colors ${big ? 'h-20' : 'h-14'} ${
        strobe ? 'border-white bg-white text-black' : 'border-line bg-inset text-zinc-300'
      }`}
    >
      <Zap size={16} />
      HOLD STROBE
    </button>
  );
}

function PresetGrid() {
  const shader = useVoxel((s) => s.shader);
  const { setShader, setParams } = useVoxelActions();
  return (
    <div className="grid grid-cols-2 gap-2">
      {PRESETS.map((p) => {
        const on = p.shader === shader;
        return (
          <button
            key={p.name}
            type="button"
            onClick={() => {
              setShader(p.shader);
              setParams(p.params);
            }}
            className="flex h-14 flex-col items-start justify-center rounded-xl border bg-inset px-3 text-left transition-colors"
            style={{ borderColor: on ? p.color : '#27272a', boxShadow: on ? `inset 0 0 0 1px ${p.color}55` : undefined }}
          >
            <span className="text-[12px] font-medium" style={{ color: on ? p.color : '#e4e4e7' }}>
              {p.name}
            </span>
            <span className="font-mono text-[9px] text-zinc-500">{SHADER_PRESETS.find((s) => s.id === p.shader)?.short}</span>
          </button>
        );
      })}
    </div>
  );
}

function PadSurface({ form }: { form: Form }) {
  const params = useVoxel((s) => s.params);
  const stats = useVoxel((s) => s.stats);
  const { setParams, setOriginAxis } = useVoxelActions();
  const bright = (
    <Fader
      vertical={form === 'tablet'}
      label="Master"
      color="#E4E4E7"
      value={params.masterBrightness}
      onChange={(masterBrightness) => setParams({ masterBrightness })}
      readout={`${Math.round(params.masterBrightness * 100)}%`}
    />
  );
  const height = (
    <Fader
      vertical={form === 'tablet'}
      label="Height Y"
      color="#22C55E"
      min={0}
      max={ROOM.height}
      value={params.origin[1]}
      onChange={(v) => setOriginAxis(1, +v.toFixed(3))}
      readout={`${params.origin[1].toFixed(2)} m`}
    />
  );
  const header = (
    <div className="flex items-center justify-between font-mono text-[10px] text-zinc-500">
      <span>
        X <span className="text-ax-x">{params.origin[0].toFixed(2)}</span> Z <span className="text-ax-z">{params.origin[2].toFixed(2)}</span>
      </span>
      <span>
        R <span className="text-spatial">{stats.effectiveRadius.toFixed(2)}</span> · {stats.totalWatts.toFixed(0)} W
      </span>
    </div>
  );

  if (form === 'phone') {
    return (
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="text-center font-mono text-[10px] tracking-[0.3em] text-zinc-600">VOXEL // LIVE</div>
        {header}
        <div className="aspect-[7/5] w-full">
          <SpatialPad />
        </div>
        {height}
        <PresetGrid />
        {bright}
        <div className="mt-auto">
          <StrobeButton />
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-[1fr_64px_64px_250px] gap-4 p-5">
      <div className="flex min-h-0 flex-col gap-2">
        {header}
        <div className="min-h-0 flex-1">
          <SpatialPad />
        </div>
      </div>
      {height}
      {bright}
      <div className="flex flex-col gap-3">
        <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-600">VOXEL // LIVE</div>
        <PresetGrid />
        <div className="mt-auto">
          <StrobeButton big />
        </div>
      </div>
    </div>
  );
}

export function LiveControlPad() {
  const [form, setForm] = useState<Form>('tablet');
  const frame =
    form === 'tablet'
      ? { width: 'min(100%, 1060px)', aspectRatio: '1.5 / 1', radius: 28 }
      : { width: 'min(100%, 390px)', aspectRatio: '390 / 820', radius: 44 };

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-auto p-5">
      <div className="flex w-full max-w-[1060px] items-center gap-3">
        <span className="text-[13px] font-medium text-zinc-200">Live Control Pad</span>
        <span className="text-[11px] text-zinc-500">Touch surface preview. Drives the same state as the Studio viewport.</span>
        <Segmented<Form>
          className="ml-auto w-[240px]"
          value={form}
          onChange={setForm}
          options={[
            { value: 'tablet', label: 'Tablet', icon: Tablet },
            { value: 'phone', label: 'Phone', icon: Smartphone },
          ]}
        />
      </div>
      <div
        className="shrink-0 border-[10px] border-[#1c1c20] bg-black shadow-[0_0_0_1px_#27272a]"
        style={{ width: frame.width, aspectRatio: frame.aspectRatio, borderRadius: frame.radius, maxHeight: form === 'phone' ? 'calc(100vh - 140px)' : undefined }}
      >
        <div className="h-full w-full overflow-hidden" style={{ borderRadius: frame.radius - 10 }}>
          <PadSurface form={form} />
        </div>
      </div>
    </div>
  );
}
