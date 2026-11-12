import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Box, Focus, Globe } from 'lucide-react';
import { useVoxel, useVoxelActions, useVoxelStoreRef } from '../../state/useVoxelStore';
import type { SensorNode, Vec3 } from '../../types/voxel';
import { KIND_META, MAX_LEDS, ROOM, SHADER_PRESETS } from '../../services/catalog';
import { runtime } from '../../services/engine';
import { sensorChannels } from '../../services/sensors';

const LED_FLOOR = 0.045;
/** Ray-to-handle distance that grabs a handle, in meters. */
const HANDLE_GRAB = 0.14;

type ViewPreset = 'persp' | 'top' | 'front' | 'side';
type ViewCommand = { kind: 'preset'; preset: ViewPreset } | { kind: 'focus' };

interface Handle {
  pos: THREE.Vector3;
  apply: (p: Vec3) => void;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

function edges(w: number, h: number, d: number, x: number, y: number, z: number, color: number, opacity: number) {
  const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d));
  const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  line.position.set(x, y, z);
  return line;
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const obj = o as THREE.Mesh;
    obj.geometry?.dispose();
    const mat = obj.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}

interface SensorGizmo {
  id: string;
  keys: string[];
  group: THREE.Group;
  core: THREE.Mesh;
  halo: THREE.LineSegments;
}

/** Kind-colored octahedron, faint influence sphere and a dashed drop line to the floor. */
function buildSensorGizmo(x: SensorNode): SensorGizmo {
  const color = new THREE.Color(KIND_META[x.kind].color);
  const group = new THREE.Group();
  group.position.set(x.position[0], x.position[1], x.position[2]);
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.07),
    new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: x.enabled ? 1 : 0.35 }),
  );
  core.renderOrder = 12;
  const halo = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1, 2)),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.08, depthWrite: false }),
  );
  halo.scale.setScalar(x.radius);
  const drop = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -x.position[1], 0)]),
    new THREE.LineDashedMaterial({ color, dashSize: 0.05, gapSize: 0.05, transparent: true, opacity: 0.5 }),
  );
  drop.computeLineDistances();
  group.add(halo, drop, core);
  return { id: x.id, keys: sensorChannels(x).map((c) => c.key), group, core, halo };
}

function buildRoom(): THREE.Group {
  const g = new THREE.Group();
  g.add(edges(ROOM.width, ROOM.height, ROOM.depth, 0, ROOM.height / 2, 0, 0x3f3f46, 0.55));
  // Sofa (back wall side), facing the TV cabinet.
  g.add(edges(2.4, 0.42, 0.9, 0, 0.21, -1.55, 0x52525b, 0.5));
  g.add(edges(2.4, 0.45, 0.2, 0, 0.645, -1.9, 0x52525b, 0.5));
  g.add(edges(0.2, 0.62, 0.9, -1.3, 0.31, -1.55, 0x52525b, 0.5));
  g.add(edges(0.2, 0.62, 0.9, 1.3, 0.31, -1.55, 0x52525b, 0.5));
  // Coffee table.
  g.add(edges(1.1, 0.06, 0.55, 0, 0.4, 1.0, 0x52525b, 0.5));
  g.add(edges(1.0, 0.34, 0.45, 0, 0.17, 1.0, 0x3f3f46, 0.35));
  // TV cabinet and screen.
  g.add(edges(5.6, 0.45, 0.4, 0, 0.345, 2.25, 0x52525b, 0.5));
  g.add(edges(1.65, 0.93, 0.05, 0, 1.25, 2.45, 0x52525b, 0.45));
  return g;
}

export function ThreeVoxelCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);
  const camRef = useRef<HTMLSpanElement>(null);
  const commandRef = useRef<(c: ViewCommand) => void>(() => undefined);
  const store = useVoxelStoreRef();
  const { selectStrip, selectSensor, setParams, updateSensor, updateStrip } = useVoxelActions();

  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x09090b, 1);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);

    // Orbit state: `goal` follows input, `cur` eases toward it.
    const goal = { theta: 0.62, phi: 1.12, radius: 10.5, target: new THREE.Vector3(0, 1.1, 0) };
    const cur = { theta: goal.theta, phi: goal.phi, radius: goal.radius, target: goal.target.clone() };

    const grid = new THREE.GridHelper(16, 32, 0x2a2a30, 0x17171b);
    scene.add(grid);

    const room = buildRoom();
    scene.add(room);

    const sphere = new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 28, 16)),
      new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.2, depthWrite: false }),
    );
    scene.add(sphere);

    const gizmo = new THREE.Group();
    const axes = new THREE.AxesHelper(0.55);
    axes.setColors(new THREE.Color(0xef4444), new THREE.Color(0x22c55e), new THREE.Color(0x3b82f6));
    (axes.material as THREE.LineBasicMaterial).depthTest = false;
    axes.renderOrder = 10;
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.045),
      new THREE.MeshBasicMaterial({ color: 0x06b6d4, depthTest: false }),
    );
    core.renderOrder = 11;
    gizmo.add(axes, core);
    scene.add(gizmo);

    const ledGeo = new THREE.IcosahedronGeometry(0.024, 1);
    const ledMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    const leds = new THREE.InstancedMesh(ledGeo, ledMat, MAX_LEDS);
    leds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LEDS * 3), 3);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    leds.instanceColor = colorAttr;
    leds.frustumCulled = false;
    leds.count = 0;
    scene.add(leds);

    const handleMat = new THREE.MeshBasicMaterial({ color: 0x06b6d4, depthTest: false, transparent: true, opacity: 0.9 });
    const handleGeo = new THREE.SphereGeometry(0.045, 12, 8);
    const endHandles = [new THREE.Mesh(handleGeo, handleMat), new THREE.Mesh(handleGeo, handleMat)];
    for (const h of endHandles) {
      h.renderOrder = 12;
      h.visible = false;
      scene.add(h);
    }

    const selGeo = new THREE.BufferGeometry();
    const selLine = new THREE.Line(selGeo, new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.55 }));
    scene.add(selLine);

    const sensorRoot = new THREE.Group();
    scene.add(sensorRoot);
    let gizmos: SensorGizmo[] = [];
    let sensorsSeen: SensorNode[] | null = null;
    const syncSensors = (sensors: SensorNode[]) => {
      for (const g of gizmos) {
        sensorRoot.remove(g.group);
        disposeTree(g.group);
      }
      gizmos = sensors.filter((x) => x.visible).map(buildSensorGizmo);
      for (const g of gizmos) sensorRoot.add(g.group);
      sensorsSeen = sensors;
    };

    let layoutVersion = -1;
    let selected: string | null | undefined;
    const m = new THREE.Matrix4();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);

    const syncLayout = () => {
      const { layout } = runtime;
      const p = layout.positions;
      for (let i = 0; i < layout.total; i++) {
        const r = layout.ranges[layout.rangeOf[i]];
        if (r.visible && !layout.dark[i]) leds.setMatrixAt(i, m.makeTranslation(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]));
        else leds.setMatrixAt(i, zero);
      }
      leds.count = layout.total;
      leds.instanceMatrix.needsUpdate = true;
      layoutVersion = runtime.layoutVersion;
      selected = undefined;
    };

    const syncSelection = (id: string | null) => {
      selected = id;
      const r = runtime.layout.ranges.find((x) => x.stripId === id);
      if (!r || !r.visible) {
        selLine.visible = false;
        return;
      }
      selGeo.setAttribute('position', new THREE.BufferAttribute(runtime.layout.positions.slice(r.start * 3, (r.start + r.count) * 3), 3));
      selGeo.computeBoundingSphere();
      selLine.visible = true;
    };

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    // Input: drag a handle to move it (Alt: vertical, Cmd/Ctrl: 10 cm grid), otherwise left
    // drag orbits, right / Shift drag pans, wheel zooms, click picks a sensor or segment.
    const el = renderer.domElement;
    let drag: { x: number; y: number; mode: 'orbit' | 'pan' | 'handle'; moved: number; handle?: Handle; plane?: THREE.Plane } | null = null;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const tmp = new THREE.Vector3();
    const hit = new THREE.Vector3();

    const aim = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
    };

    /** Draggable points: effect origin, visible sensors, and the selected segment's anchors. */
    const handles = (): Handle[] => {
      const s = store.getState();
      const list: Handle[] = [{ pos: new THREE.Vector3(...s.params.origin), apply: (origin) => setParams({ origin }) }];
      for (const x of s.sensors) {
        if (x.visible) list.push({ pos: new THREE.Vector3(...x.position), apply: (position) => updateSensor(x.id, { position }) });
      }
      const strip = s.strips.find((x) => x.id === s.selectedStripId);
      if (strip && strip.shape !== 'points' && strip.shape !== 'polyline') {
        list.push({ pos: new THREE.Vector3(...strip.start), apply: (start) => updateStrip(strip.id, { start }) });
        if (strip.shape !== 'arc') list.push({ pos: new THREE.Vector3(...strip.end), apply: (end) => updateStrip(strip.id, { end }) });
      }
      return list;
    };

    const pick = (clientX: number, clientY: number) => {
      aim(clientX, clientY);
      let hitSensor: string | null = null;
      let hitD = 0.15 * 0.15;
      for (const g of gizmos) {
        const d = ray.ray.distanceSqToPoint(g.group.position);
        if (d < hitD) {
          hitD = d;
          hitSensor = g.id;
        }
      }
      if (hitSensor) {
        selectSensor(hitSensor);
        return;
      }
      const { layout } = runtime;
      let best = -1;
      let bestD = 0.12 * 0.12;
      for (let i = 0; i < layout.total; i++) {
        const r = layout.ranges[layout.rangeOf[i]];
        if (!r.visible || layout.dark[i]) continue;
        tmp.fromArray(layout.positions, i * 3);
        const d = ray.ray.distanceSqToPoint(tmp);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      selectStrip(best >= 0 ? layout.ranges[layout.rangeOf[best]].stripId : null);
    };

    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      if (e.button === 0 && !e.shiftKey) {
        aim(e.clientX, e.clientY);
        let best: Handle | undefined;
        let bestD = HANDLE_GRAB * HANDLE_GRAB;
        for (const h of handles()) {
          const d = ray.ray.distanceSqToPoint(h.pos);
          if (d < bestD) {
            bestD = d;
            best = h;
          }
        }
        if (best) {
          // Horizontal plane through the handle, or a vertical plane facing the camera with Alt.
          const normal = e.altKey ? new THREE.Vector3(camera.position.x - best.pos.x, 0, camera.position.z - best.pos.z).normalize() : new THREE.Vector3(0, 1, 0);
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, best.pos);
          drag = { x: e.clientX, y: e.clientY, mode: 'handle', moved: 0, handle: best, plane };
          return;
        }
      }
      drag = { x: e.clientX, y: e.clientY, mode: e.button === 2 || e.shiftKey ? 'pan' : 'orbit', moved: 0 };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      if (drag.mode === 'handle' && drag.handle && drag.plane) {
        aim(e.clientX, e.clientY);
        if (!ray.ray.intersectPlane(drag.plane, hit)) return;
        drag.moved += 5;
        const snap = (v: number) => (e.metaKey || e.ctrlKey ? Math.round(v * 10) / 10 : round3(v));
        const p = drag.handle.pos;
        const next: Vec3 = e.altKey && drag.plane.normal.y === 0 ? [p.x, snap(hit.y), p.z] : [snap(hit.x), p.y, snap(hit.z)];
        drag.handle.apply(next);
        return;
      }
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.mode === 'orbit') {
        goal.theta -= dx * 0.0065;
        goal.phi = Math.max(0.08, Math.min(Math.PI / 2 - 0.02, goal.phi - dy * 0.0065));
      } else {
        const s = goal.radius * 0.0011;
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
        goal.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (drag && drag.mode !== 'handle' && drag.moved < 4 && e.button === 0) pick(e.clientX, e.clientY);
      drag = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      goal.radius = Math.max(2, Math.min(40, goal.radius * Math.exp(e.deltaY * 0.0012)));
    };
    const onContext = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContext);

    const PRESETS: Record<ViewPreset, { theta: number; phi: number; radius: number }> = {
      persp: { theta: 0.62, phi: 1.12, radius: 10.5 },
      top: { theta: 0, phi: 0.08, radius: 11 },
      front: { theta: 0, phi: Math.PI / 2 - 0.04, radius: 10 },
      side: { theta: Math.PI / 2, phi: Math.PI / 2 - 0.04, radius: 10 },
    };
    commandRef.current = (c) => {
      if (c.kind === 'preset') {
        Object.assign(goal, PRESETS[c.preset]);
        goal.target.set(0, 1.1, 0);
        return;
      }
      // Focus: frame the selected segment, else the selected sensor, else the effect origin.
      const s = store.getState();
      const box = new THREE.Box3();
      const r = runtime.layout.ranges.find((x) => x.stripId === s.selectedStripId);
      const sensor = s.sensors.find((x) => x.id === s.selectedSensorId);
      if (r) {
        for (let i = r.start; i < r.start + r.count; i++) box.expandByPoint(tmp.fromArray(runtime.layout.positions, i * 3));
      } else if (sensor) {
        box.setFromCenterAndSize(new THREE.Vector3(...sensor.position), new THREE.Vector3(1, 1, 1).multiplyScalar(sensor.radius));
      } else {
        box.setFromCenterAndSize(new THREE.Vector3(...s.params.origin), new THREE.Vector3(2, 2, 2));
      }
      box.getCenter(goal.target);
      goal.radius = Math.max(2, box.getSize(tmp).length() * 1.6);
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!host.clientWidth || t.tagName === 'INPUT' || t.tagName === 'SELECT' || e.metaKey || e.ctrlKey) return;
      if (e.key.toLowerCase() === 'f') commandRef.current({ kind: 'focus' });
    };
    window.addEventListener('keydown', onKey);

    let raf = 0;
    let frame = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!host.clientWidth) return; // hidden view: skip GPU work

      const s = store.getState();
      if (layoutVersion !== runtime.layoutVersion) syncLayout();
      if (selected !== s.selectedStripId) syncSelection(s.selectedStripId);
      const sel = s.strips.find((x) => x.id === s.selectedStripId);
      const anchored = sel && sel.shape !== 'points' && sel.shape !== 'polyline';
      endHandles[0].visible = !!anchored;
      endHandles[1].visible = !!anchored && sel.shape !== 'arc';
      if (anchored) {
        endHandles[0].position.set(...sel.start);
        endHandles[1].position.set(...sel.end);
      }
      if (sensorsSeen !== s.sensors) syncSensors(s.sensors);
      for (const g of gizmos) {
        let level = 0;
        for (const key of g.keys) level = Math.max(level, runtime.sensorValues[key] ?? 0);
        g.core.scale.setScalar(1 + level * 0.8);
        (g.halo.material as THREE.LineBasicMaterial).opacity = (g.id === s.selectedSensorId ? 0.2 : 0.05) + level * 0.12;
      }

      const k = 0.2;
      cur.theta += (goal.theta - cur.theta) * k;
      cur.phi += (goal.phi - cur.phi) * k;
      cur.radius += (goal.radius - cur.radius) * k;
      cur.target.lerp(goal.target, k);
      const sp = Math.sin(cur.phi);
      camera.position.set(
        cur.target.x + cur.radius * sp * Math.sin(cur.theta),
        cur.target.y + cur.radius * Math.cos(cur.phi),
        cur.target.z + cur.radius * sp * Math.cos(cur.theta),
      );
      camera.lookAt(cur.target);

      const src = runtime.colors;
      const dst = colorAttr.array as Float32Array;
      const n = runtime.layout.total * 3;
      for (let i = 0; i < n; i++) {
        const v = src[i];
        dst[i] = v < LED_FLOOR ? LED_FLOOR : v;
      }
      colorAttr.clearUpdateRanges();
      colorAttr.addUpdateRange(0, n);
      colorAttr.needsUpdate = true;

      const { origin, radius } = runtime.params;
      sphere.visible = s.showSphere;
      sphere.position.set(origin[0], origin[1], origin[2]);
      sphere.scale.setScalar(radius);
      gizmo.position.set(origin[0], origin[1], origin[2]);
      room.visible = s.showRoom;

      if (++frame % 6 === 0 && camRef.current) {
        const p = camera.position;
        camRef.current.textContent = `CAM ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}  ·  FOV 42°`;
      }
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContext);
      scene.traverse((o) => {
        const obj = o as THREE.Mesh;
        obj.geometry?.dispose();
        const mat = obj.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      host.removeChild(el);
    };
  }, [store, selectStrip, selectSensor, setParams, updateSensor, updateStrip]);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={hostRef} className="absolute inset-0" />
      <ShaderPill />
      <ViewportToggles />
      <ViewPresets onCommand={(c) => commandRef.current(c)} />
      <span ref={camRef} className="pointer-events-none absolute right-3 top-3 font-mono text-[10px] text-zinc-600" />
      <span className="pointer-events-none absolute bottom-2 right-3 text-[10px] text-zinc-600">
        Drag orbit · Shift/Right drag pan · Wheel zoom · Drag handles to move (Alt vertical, Cmd grid) · F focus
      </span>
    </div>
  );
}

function ShaderPill() {
  const shader = useVoxel((s) => s.shader);
  const { setShader } = useVoxelActions();
  return (
    <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-line bg-panel/90 p-0.5 backdrop-blur">
      {SHADER_PRESETS.map((p, i) => {
        const on = p.id === shader;
        return (
          <button
            key={p.id}
            type="button"
            title={p.description}
            onClick={() => setShader(p.id)}
            className={`flex h-6 items-center gap-1.5 rounded-full px-3 font-mono text-[10px] tracking-wider transition-colors ${
              on ? 'bg-spatial/15 text-spatial' : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            <span className="text-zinc-600">{String(i + 1).padStart(2, '0')}</span>
            {p.short}
          </button>
        );
      })}
    </div>
  );
}

function ViewportToggles() {
  const showRoom = useVoxel((s) => s.showRoom);
  const showSphere = useVoxel((s) => s.showSphere);
  const { toggle } = useVoxelActions();
  const btn = (on: boolean, onClick: () => void, label: string, Icon: typeof Box) => (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-6 items-center gap-1.5 rounded-[5px] border px-2 text-[10px] transition-colors ${
        on ? 'border-line-hi bg-card text-zinc-200' : 'border-line bg-panel/80 text-zinc-600'
      }`}
    >
      <Icon size={11} strokeWidth={1.75} />
      {label}
    </button>
  );
  return (
    <div className="absolute left-3 top-3 flex gap-1">
      {btn(showRoom, () => toggle('showRoom'), 'Room', Box)}
      {btn(showSphere, () => toggle('showSphere'), 'Sphere', Globe)}
    </div>
  );
}

function ViewPresets({ onCommand }: { onCommand: (c: ViewCommand) => void }) {
  const views: { preset: ViewPreset; label: string }[] = [
    { preset: 'persp', label: 'Persp' },
    { preset: 'top', label: 'Top' },
    { preset: 'front', label: 'Front' },
    { preset: 'side', label: 'Side' },
  ];
  return (
    <div className="absolute bottom-2 left-3 flex items-center gap-0.5 rounded-[5px] border border-line bg-panel/90 p-0.5">
      {views.map((v) => (
        <button
          key={v.preset}
          type="button"
          onClick={() => onCommand({ kind: 'preset', preset: v.preset })}
          className="h-5 rounded-[3px] px-2 text-[10px] text-zinc-400 hover:bg-card hover:text-zinc-100"
        >
          {v.label}
        </button>
      ))}
      <span className="mx-0.5 h-3 w-px bg-line" />
      <button
        type="button"
        onClick={() => onCommand({ kind: 'focus' })}
        title="Frame the selection (F)"
        className="flex h-5 items-center gap-1 rounded-[3px] px-2 text-[10px] text-zinc-400 hover:bg-card hover:text-zinc-100"
      >
        <Focus size={10} /> Focus
      </button>
    </div>
  );
}
