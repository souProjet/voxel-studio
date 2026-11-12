import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Camera, Crosshair, Pause, Play, RotateCcw, ScanLine, Target } from 'lucide-react';
import { useVoxel, useVoxelActions, useVoxelStoreRef } from '../../state/useVoxelStore';
import { ROOM } from '../../services/catalog';
import { buildLayout } from '../../services/geometry';
import { grayBit, grayDecode } from '../../services/shaderMath';
import { Card, SectionHeader, Segmented, Toggle } from '../ui/primitives';

const BITS = 10;
const IMG_W = 1920;
const IMG_H = 1080;
const PIXEL_NOISE = 0.35; // centroid noise, px (1 sigma)

type CamId = 'A' | 'B';

const CAM_DEF: Record<CamId, { label: string; angle: number }> = {
  A: { label: 'Camera A · 0°', angle: 0 },
  B: { label: 'Camera B · 45°', angle: 45 },
};

function makeCamera(id: CamId): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(48, IMG_W / IMG_H, 0.1, 100);
  const a = (CAM_DEF[id].angle * Math.PI) / 180;
  const dist = 8;
  cam.position.set(Math.sin(a) * dist, 1.6, Math.cos(a) * dist);
  cam.lookAt(0, 1.1, 0);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

/** Deterministic gaussian-ish noise per (led, camera, axis). */
function noise(i: number, salt: number): number {
  let h = (i * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const a = ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  h = Math.imul(h ^ 0x5bd1e995, 2246822519);
  const b = ((h ^ (h >>> 15)) >>> 0) / 4294967295;
  return Math.sqrt(-2 * Math.log(a + 1e-9)) * Math.cos(2 * Math.PI * b);
}

interface Detection {
  led: number;
  u: number;
  v: number;
  inFrame: boolean;
}

function detect(cam: THREE.PerspectiveCamera, positions: Float32Array, total: number, visible: (i: number) => boolean, salt: number): Detection[] {
  const out: Detection[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i < total; i++) {
    if (!visible(i)) continue;
    p.fromArray(positions, i * 3).project(cam);
    const u = ((p.x + 1) / 2) * IMG_W + noise(i, salt) * PIXEL_NOISE;
    const v = ((1 - p.y) / 2) * IMG_H + noise(i, salt + 7) * PIXEL_NOISE;
    out.push({ led: i, u, v, inFrame: p.z < 1 && u >= 0 && u <= IMG_W && v >= 0 && v <= IMG_H });
  }
  return out;
}

function rayFrom(cam: THREE.PerspectiveCamera, u: number, v: number): { o: THREE.Vector3; d: THREE.Vector3 } {
  const ndc = new THREE.Vector3((u / IMG_W) * 2 - 1, -((v / IMG_H) * 2 - 1), 0.5).unproject(cam);
  return { o: cam.position.clone(), d: ndc.sub(cam.position).normalize() };
}

/** Midpoint of the common perpendicular between two rays. */
function triangulate(a: { o: THREE.Vector3; d: THREE.Vector3 }, b: { o: THREE.Vector3; d: THREE.Vector3 }): THREE.Vector3 {
  const w0 = a.o.clone().sub(b.o);
  const A = a.d.dot(a.d), B = a.d.dot(b.d), C = b.d.dot(b.d), D = a.d.dot(w0), E = b.d.dot(w0);
  const den = A * C - B * B || 1e-9;
  const s = (B * E - C * D) / den;
  const t = (A * E - B * D) / den;
  return a.o.clone().addScaledVector(a.d, s).add(b.o.clone().addScaledVector(b.d, t)).multiplyScalar(0.5);
}

const ROOM_EDGES: [number, number, number][][] = (() => {
  const w = ROOM.width / 2, d = ROOM.depth / 2, h = ROOM.height;
  const c: [number, number, number][] = [
    [-w, 0, -d], [w, 0, -d], [w, 0, d], [-w, 0, d],
    [-w, h, -d], [w, h, -d], [w, h, d], [-w, h, d],
  ];
  const e = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  return e.map(([a, b]) => [c[a], c[b]]);
})();

const emptyCaps = (): Record<CamId, boolean[]> => ({ A: Array(BITS).fill(false), B: Array(BITS).fill(false) });

export function CameraScannerView() {
  const strips = useVoxel((s) => s.strips);
  const scan = useVoxel((s) => s.scan);
  const { setScan } = useVoxelActions();
  const store = useVoxelStoreRef();

  const [cam, setCam] = useState<CamId>('A');
  const [captured, setCaptured] = useState(emptyCaps);
  const [playing, setPlaying] = useState(false);
  const [project, setProject] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const layout = useMemo(() => buildLayout(strips), [strips]);
  const cameras = useMemo(() => ({ A: makeCamera('A'), B: makeCamera('B') }), []);
  const detections = useMemo(() => {
    const visible = (i: number) => layout.ranges[layout.rangeOf[i]]?.visible ?? false;
    return {
      A: detect(cameras.A, layout.positions, layout.total, visible, 11),
      B: detect(cameras.B, layout.positions, layout.total, visible, 23),
    };
  }, [layout, cameras]);

  const complete = (id: CamId) => captured[id].every(Boolean);
  const bitsDone = captured[cam].filter(Boolean).length;

  // Physical projection of the Gray-code pattern on the real LEDs.
  useEffect(() => {
    setScan({ active: project });
  }, [project, setScan]);
  useEffect(() => () => setScan({ active: false }), [setScan]);

  // Auto sequencer: expose, capture, advance.
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const bit = store.getState().scan.bit;
      setCaptured((c) => {
        const next = { ...c, [cam]: c[cam].map((v, i) => (i === bit ? true : v)) };
        if (next[cam].every(Boolean)) setPlaying(false);
        return next;
      });
      setScan({ bit: (bit + 1) % BITS });
    }, 420);
    return () => window.clearInterval(id);
  }, [playing, cam, setScan, store]);

  // Simulated video feed.
  const decodedRef = useRef(false);
  decodedRef.current = complete(cam);
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const noiseTile = document.createElement('canvas');
    noiseTile.width = noiseTile.height = 128;
    const nctx = noiseTile.getContext('2d')!;
    const img = nctx.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const g = Math.random() * 22;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
    nctx.putImageData(img, 0, 0);
    const pattern = ctx.createPattern(noiseTile, 'repeat')!;
    const camera = cameras[cam];
    const dets = detections[cam];
    const p = new THREE.Vector3();
    let raf = 0;
    let frameNo = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(window.devicePixelRatio, 2);
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (!cw) return;
      if (canvas.width !== cw * dpr) {
        canvas.width = cw * dpr;
        canvas.height = ch * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const sx = cw / IMG_W, sy = ch / IMG_H;
      frameNo++;

      ctx.fillStyle = '#050506';
      ctx.fillRect(0, 0, cw, ch);
      ctx.save();
      ctx.translate(-Math.random() * 128, -Math.random() * 128);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, cw + 128, ch + 128);
      ctx.restore();

      ctx.strokeStyle = 'rgba(113,113,122,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [a, b] of ROOM_EDGES) {
        p.set(...a).project(camera);
        ctx.moveTo(((p.x + 1) / 2) * cw, ((1 - p.y) / 2) * ch);
        p.set(...b).project(camera);
        ctx.lineTo(((p.x + 1) / 2) * cw, ((1 - p.y) / 2) * ch);
      }
      ctx.stroke();

      const st = store.getState().scan;
      const bit = st.bit;
      ctx.globalCompositeOperation = 'lighter';
      for (const d of dets) {
        if (!d.inFrame) continue;
        const x = d.u * sx, y = d.v * sy;
        if (grayBit(d.led, bit)) {
          const g = ctx.createRadialGradient(x, y, 0, x, y, 5);
          g.addColorStop(0, 'rgba(255,255,255,0.95)');
          g.addColorStop(0.35, 'rgba(200,240,255,0.45)');
          g.addColorStop(1, 'rgba(6,182,212,0)');
          ctx.fillStyle = g;
          ctx.fillRect(x - 5, y - 5, 10, 10);
        } else {
          ctx.fillStyle = 'rgba(82,82,91,0.5)';
          ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
        }
      }
      ctx.globalCompositeOperation = 'source-over';

      if (decodedRef.current) {
        ctx.strokeStyle = 'rgba(6,182,212,0.8)';
        ctx.fillStyle = 'rgba(6,182,212,0.9)';
        ctx.font = '9px "JetBrains Mono", monospace';
        for (const d of dets) {
          if (!d.inFrame || d.led % 20 !== 0) continue;
          const x = d.u * sx, y = d.v * sy;
          ctx.beginPath();
          ctx.moveTo(x - 6, y); ctx.lineTo(x - 2, y);
          ctx.moveTo(x + 2, y); ctx.lineTo(x + 6, y);
          ctx.moveTo(x, y - 6); ctx.lineTo(x, y - 2);
          ctx.moveTo(x, y + 2); ctx.lineTo(x, y + 6);
          ctx.stroke();
          ctx.fillText(`#${d.led} ${d.u.toFixed(0)},${d.v.toFixed(0)}`, x + 7, y - 4);
        }
      }

      // Scanlines + HUD
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = 0; y < ch; y += 3) ctx.fillRect(0, y, cw, 1);
      ctx.fillStyle = 'rgba(228,228,231,0.75)';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText(`${CAM_DEF[cam].label.toUpperCase()}  ·  ${IMG_W}×${IMG_H}  ·  EXP 1/250`, 12, 18);
      ctx.fillText(`GRAY BIT ${String(bit + 1).padStart(2, '0')}/${BITS}  ·  FRAME ${String(frameNo).padStart(6, '0')}`, 12, 32);
      ctx.strokeStyle = 'rgba(228,228,231,0.25)';
      const m = 10, l = 14;
      ctx.beginPath();
      ctx.moveTo(m, m + l); ctx.lineTo(m, m); ctx.lineTo(m + l, m);
      ctx.moveTo(cw - m - l, m); ctx.lineTo(cw - m, m); ctx.lineTo(cw - m, m + l);
      ctx.moveTo(m, ch - m - l); ctx.lineTo(m, ch - m); ctx.lineTo(m + l, ch - m);
      ctx.moveTo(cw - m - l, ch - m); ctx.lineTo(cw - m, ch - m); ctx.lineTo(cw - m, ch - m - l);
      ctx.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [cam, cameras, detections, store]);

  // Decode + triangulation report.
  const report = useMemo(() => {
    const decode = (id: CamId) => {
      const map = new Map<number, Detection>();
      if (!captured[id].every(Boolean)) return map;
      for (const d of detections[id]) {
        if (!d.inFrame) continue;
        let code = 0;
        for (let b = 0; b < BITS; b++) if (grayBit(d.led, b)) code |= 1 << b;
        map.set(grayDecode(code), d);
      }
      return map;
    };
    const a = decode('A');
    const b = decode('B');
    const errors: number[] = [];
    let reproj = 0;
    for (const [led, da] of a) {
      const db = b.get(led);
      if (!db) continue;
      const X = triangulate(rayFrom(cameras.A, da.u, da.v), rayFrom(cameras.B, db.u, db.v));
      const truth = new THREE.Vector3().fromArray(layout.positions, led * 3);
      errors.push(X.distanceTo(truth) * 1000);
      const pr = X.clone().project(cameras.A);
      reproj += Math.hypot(((pr.x + 1) / 2) * IMG_W - da.u, ((1 - pr.y) / 2) * IMG_H - da.v);
    }
    const n = errors.length;
    const mean = n ? errors.reduce((s, e) => s + e, 0) / n : 0;
    const rms = n ? Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / n) : 0;
    const sorted = [...errors].sort((x, y) => x - y);
    return {
      decodedA: a.size,
      decodedB: b.size,
      triangulated: n,
      mean,
      rms,
      p95: n ? sorted[Math.floor(n * 0.95)] : 0,
      max: n ? sorted[n - 1] : 0,
      reproj: n ? reproj / n : 0,
    };
  }, [captured, detections, cameras, layout]);

  const rows = detections[cam].filter((d) => d.inFrame).slice(0, 400);
  const decoded = complete(cam);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <ScanLine size={14} className="text-spatial" />
          <span className="text-[13px] font-medium text-zinc-200">Optical Auto-Calibration</span>
          <span className="text-[11px] text-zinc-500">10-bit reflected Gray code · stereo triangulation</span>
          <span className="ml-auto rounded-[4px] border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-500">
            Simulated camera feed
          </span>
        </div>
        <div className="relative w-full overflow-hidden rounded-md border border-line bg-black" style={{ aspectRatio: '16 / 9', maxHeight: 'calc(100vh - 260px)' }}>
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          {playing && (
            <span className="absolute right-3 top-3 flex items-center gap-1.5 font-mono text-[10px] text-red-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> REC
            </span>
          )}
        </div>
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="grid h-7 shrink-0 grid-cols-[60px_80px_80px_1fr_80px] items-center border-b border-line px-3 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            <span>LED</span>
            <span>u px</span>
            <span>v px</span>
            <span>Gray code (b10…b1)</span>
            <span className="text-right">Decoded</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rows.map((d) => {
              const bits = captured[cam];
              const code = Array.from({ length: BITS }, (_, i) => BITS - 1 - i)
                .map((b) => (bits[b] ? (grayBit(d.led, b) ? '1' : '0') : '·'))
                .join('');
              let gray = 0;
              for (let b = 0; b < BITS; b++) if (grayBit(d.led, b)) gray |= 1 << b;
              return (
                <div key={d.led} className="grid h-6 grid-cols-[60px_80px_80px_1fr_80px] items-center px-3 font-mono text-[10px] text-zinc-400 odd:bg-inset/60">
                  <span className="text-zinc-300">#{d.led}</span>
                  <span>{d.u.toFixed(1)}</span>
                  <span>{d.v.toFixed(1)}</span>
                  <span className="tracking-[0.2em] text-zinc-500">{code}</span>
                  <span className={`text-right ${decoded ? 'text-spatial' : 'text-zinc-600'}`}>{decoded ? grayDecode(gray) : '—'}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <aside className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-line bg-panel">
        <SectionHeader title="Capture" icon={Camera} />
        <div className="flex flex-col gap-2.5 p-3">
          <Segmented<CamId>
            value={cam}
            onChange={(c) => {
              setPlaying(false);
              setCam(c);
            }}
            options={[
              { value: 'A', label: 'Cam A 0°' },
              { value: 'B', label: 'Cam B 45°' },
            ]}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-zinc-400">Project pattern on LEDs</span>
            <Toggle checked={project} onChange={setProject} title="Drives the physical LEDs with the current Gray-code bit" />
          </div>
          <div className="grid grid-cols-5 gap-1">
            {Array.from({ length: BITS }, (_, i) => {
              const isCur = scan.bit === i;
              const done = captured[cam][i];
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setScan({ bit: i });
                    setCaptured((c) => ({ ...c, [cam]: c[cam].map((v, k) => (k === i ? true : v)) }));
                  }}
                  className={`flex h-9 flex-col items-center justify-center rounded-[5px] border font-mono text-[10px] transition-colors ${
                    isCur ? 'border-spatial bg-spatial/10 text-spatial' : done ? 'border-line-hi bg-card text-zinc-300' : 'border-line bg-inset text-zinc-600 hover:border-line-hi'
                  }`}
                >
                  <span className="text-[8px] uppercase text-zinc-500">Bit</span>
                  {i + 1}
                  <span className={`mt-0.5 h-0.5 w-3 rounded ${done ? 'bg-net' : 'bg-line'}`} />
                </button>
              );
            })}
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              disabled={decoded}
              className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[5px] border border-spatial/50 bg-spatial/10 text-[11px] text-spatial disabled:opacity-40"
            >
              {playing ? <Pause size={12} /> : <Play size={12} />}
              {playing ? 'Pause' : decoded ? 'Sequence done' : 'Run sequence'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                setCaptured((c) => ({ ...c, [cam]: Array(BITS).fill(false) }));
                setScan({ bit: 0 });
              }}
              title="Reset this camera"
              className="flex h-7 w-7 items-center justify-center rounded-[5px] border border-line text-zinc-500 hover:border-line-hi hover:text-zinc-200"
            >
              <RotateCcw size={12} />
            </button>
          </div>
          <div className="flex items-center justify-between font-mono text-[10px] text-zinc-500">
            <span>
              captured <span className="text-zinc-300">{bitsDone}/{BITS}</span>
            </span>
            <span>
              in frame <span className="text-zinc-300">{rows.length}</span>
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-spatial transition-all" style={{ width: `${(bitsDone / BITS) * 100}%` }} />
          </div>
        </div>

        <SectionHeader title="Triangulation" icon={Target} />
        <div className="flex flex-col gap-2 p-3">
          <div className="grid grid-cols-2 gap-1.5">
            {(['A', 'B'] as CamId[]).map((id) => (
              <div key={id} className="rounded-[5px] border border-line bg-inset px-2 py-1.5">
                <div className="text-[10px] text-zinc-500">Cam {id} decoded</div>
                <div className={`font-mono text-[13px] ${complete(id) ? 'text-spatial' : 'text-zinc-600'}`}>{id === 'A' ? report.decodedA : report.decodedB}</div>
              </div>
            ))}
          </div>
          {report.triangulated > 0 ? (
            <div className="flex flex-col gap-1 rounded-[5px] border border-line bg-inset p-2 font-mono text-[11px]">
              {[
                ['Triangulated', `${report.triangulated} LEDs`, 'text-zinc-200'],
                ['Mean error', `${report.mean.toFixed(2)} mm`, 'text-net'],
                ['RMS error', `${report.rms.toFixed(2)} mm`, 'text-net'],
                ['P95 error', `${report.p95.toFixed(2)} mm`, 'text-gps'],
                ['Max error', `${report.max.toFixed(2)} mm`, 'text-gps'],
                ['Reproj. A', `${report.reproj.toFixed(3)} px`, 'text-zinc-300'],
              ].map(([k, v, c]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-zinc-500">{k}</span>
                  <span className={c}>{v}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-[5px] border border-dashed border-line p-2 text-[11px] leading-snug text-zinc-500">
              <Crosshair size={12} className="mt-0.5 shrink-0" />
              Capture all 10 bits on both cameras to decode LED IDs and triangulate 3D positions.
            </div>
          )}
          <p className="text-[10px] leading-snug text-zinc-600">
            Centroid noise σ = {PIXEL_NOISE} px. Rays are back-projected from each camera and intersected at the midpoint of
            their common perpendicular; error is measured against the mapped layout.
          </p>
        </div>
      </aside>
    </div>
  );
}
