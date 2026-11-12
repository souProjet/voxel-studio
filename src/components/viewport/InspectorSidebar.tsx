import { ArrowDown, ArrowUp, Copy, Crosshair, Flashlight, Minus, Plus, SlidersHorizontal, Trash } from 'lucide-react';
import type { Axis, ColorOrder, Falloff, PaletteId, LEDStrip, LedChipset, SensorNode, SensorSourceId, StripShape, Vec3 } from '../../types/voxel';
import { useVoxel, useVoxelActions } from '../../state/useVoxelStore';
import { useDeleteCommands } from '../../state/useDeleteCommands';
import { CHIPSETS, KIND_META, PALETTES, SCENARIOS, SHADER_PRESETS, TARGET_META } from '../../services/catalog';
import { activeCount, polylineVertices, stripLength } from '../../services/geometry';
import { denormalize, manualDefault, oscAddressOf, SENSOR_SOURCES, sensorChannels, sensorIdOf, sourceStatus } from '../../services/sensors';
import { ScrubInput } from '../ui/ScrubInput';
import { Field, IconButton, SectionHeader, Segmented, Select, TextInput, Toggle } from '../ui/primitives';
import { KIND_ICON } from '../ui/sensorIcons';
import { t, tk } from '../../i18n';

function Vec3Input({ value, onChange, min = -10, max = 10 }: { value: Vec3; onChange: (v: Vec3) => void; min?: number; max?: number }) {
  const set = (i: 0 | 1 | 2, x: number) => {
    const next = [...value] as Vec3;
    next[i] = x;
    onChange(next);
  };
  return (
    <div className="grid min-w-0 flex-1 grid-cols-3 gap-1">
      <ScrubInput axis="x" label="X" value={value[0]} onChange={(v) => set(0, v)} min={min} max={max} step={0.01} />
      <ScrubInput axis="y" label="Y" value={value[1]} onChange={(v) => set(1, v)} min={min} max={max} step={0.01} />
      <ScrubInput axis="z" label="Z" value={value[2]} onChange={(v) => set(2, v)} min={min} max={max} step={0.01} />
    </div>
  );
}

const paletteCss = (id: PaletteId) =>
  id === 'spectrum' ? 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' : `linear-gradient(90deg,${PALETTES[id].stops.map(([at, c]) => `${c} ${at * 100}%`).join(',')})`;

function EffectSection() {
  const params = useVoxel((s) => s.params);
  const shader = useVoxel((s) => s.shader);
  const stats = useVoxel((s) => s.stats);
  const { setParams, setOriginAxis, tapTempo } = useVoxelActions();
  const preset = SHADER_PRESETS.find((p) => p.id === shader)!;

  return (
    <>
      <SectionHeader title={t('Effect')} icon={Crosshair} right={<span className="font-mono text-[10px] text-spatial">{t(preset.short)}</span>} />
      <div className="flex flex-col gap-1.5 p-3">
        <p className="text-[11px] leading-snug text-zinc-500">{t(preset.description)}</p>
        <div className="mt-1 text-[10px] uppercase tracking-wider text-zinc-500">{t('Origin')}</div>
        <div className="grid grid-cols-3 gap-1">
          <ScrubInput axis="x" label="X" value={params.origin[0]} onChange={(v) => setOriginAxis(0, v)} min={-3.5} max={3.5} step={0.01} unit="m" />
          <ScrubInput axis="y" label="Y" value={params.origin[1]} onChange={(v) => setOriginAxis(1, v)} min={0} max={2.4} step={0.01} unit="m" />
          <ScrubInput axis="z" label="Z" value={params.origin[2]} onChange={(v) => setOriginAxis(2, v)} min={-2.5} max={2.5} step={0.01} unit="m" />
        </div>
        <Field label={t('Radius')}>
          <ScrubInput
            value={params.radius}
            onChange={(radius) => setParams({ radius })}
            min={0.05}
            max={6}
            step={0.01}
            unit="m"
            accent="#06B6D4"
            modulated={stats.effectiveRadius}
            className="flex-1"
          />
        </Field>
        <Field label={t('Speed')}>
          <ScrubInput
            value={params.speed}
            onChange={(speed) => setParams({ speed })}
            min={0}
            max={6}
            step={0.01}
            unit="x"
            accent="#06B6D4"
            modulated={stats.effectiveSpeed}
            className="flex-1"
          />
        </Field>
        <Field label={t('Hue shift')}>
          <ScrubInput
            value={params.hueShift}
            onChange={(hueShift) => setParams({ hueShift })}
            min={0}
            max={1}
            step={0.005}
            precision={3}
            unit={t('turn')}
            accent="#06B6D4"
            modulated={stats.effectiveHueShift}
            className="flex-1"
          />
        </Field>
        <Field label={t('Master')}>
          <ScrubInput
            value={params.masterBrightness}
            onChange={(masterBrightness) => setParams({ masterBrightness })}
            min={0}
            max={1}
            step={0.01}
            displayScale={100}
            unit="%"
            accent="#06B6D4"
            modulated={stats.effectiveBrightness}
            className="flex-1"
          />
        </Field>
        <Field label={t('Palette')}>
          <div className="flex flex-1 items-center gap-1.5">
            <span className="h-4 w-10 shrink-0 rounded-[3px] border border-line" style={{ background: paletteCss(params.palette) }} />
            <div className="flex-1">
              <Select<PaletteId>
                value={params.palette}
                onChange={(palette) => setParams({ palette })}
                options={(Object.keys(PALETTES) as PaletteId[]).map((id) => ({ value: id, label: t(PALETTES[id].label) }))}
              />
            </div>
          </div>
        </Field>
        <Field label={t('Crossfade')}>
          <ScrubInput value={params.fadeSec} onChange={(fadeSec) => setParams({ fadeSec })} min={0} max={8} step={0.05} unit="s" accent="#06B6D4" className="flex-1" />
        </Field>
        <Field label={t('Tempo')}>
          <div className="flex flex-1 items-center gap-1.5">
            <ScrubInput value={params.bpm} onChange={(bpm) => setParams({ bpm })} min={30} max={300} step={0.1} precision={1} unit="bpm" accent="#D946EF" className="flex-1" />
            <button
              type="button"
              title={t('Tap tempo (T)')}
              onClick={tapTempo}
              className="h-6 rounded-[5px] border border-audio/40 px-2 font-mono text-[10px] text-audio active:bg-audio/20"
            >
              TAP
            </button>
            <Toggle checked={params.bpmSync} onChange={(bpmSync) => setParams({ bpmSync })} color="#D946EF" title={t('Sync speed to tempo (120 BPM = 1x)')} />
          </div>
        </Field>
        <div className="mt-1 grid grid-cols-3 gap-1 rounded-[5px] border border-line bg-inset px-2 py-1.5 font-mono text-[10px]">
          <span className="text-zinc-500">
            r <span className="text-audio">{stats.effectiveRadius.toFixed(2)}</span>
          </span>
          <span className="text-zinc-500">
            {t('spd')} <span className="text-audio">{stats.effectiveSpeed.toFixed(2)}</span>
          </span>
          <span className="text-zinc-500">
            {t('hue')} <span className="text-audio">{stats.effectiveHueShift.toFixed(2)}</span>
          </span>
        </div>
      </div>
    </>
  );
}

const SHAPES: { value: StripShape; label: string }[] = [
  { value: 'line', label: tk('Line') },
  { value: 'helix', label: tk('Helix') },
  { value: 'polyline', label: tk('Polyline (corners)') },
  { value: 'arc', label: tk('Arc / Ring') },
  { value: 'matrix', label: tk('Matrix panel') },
  { value: 'points', label: tk('Imported points') },
];

const COLOR_ORDERS: ColorOrder[] = ['RGB', 'GRB', 'BRG', 'RBG', 'GBR', 'BGR'];

function SegmentSection({ strip }: { strip: LEDStrip }) {
  const devices = useVoxel((s) => s.devices);
  const strips = useVoxel((s) => s.strips);
  const { updateStrip, duplicateStrip, moveStrip, setStripShape, setMatrix, identifyStrip } = useVoxelActions();
  const del = useDeleteCommands();
  const set = (patch: Partial<LEDStrip>) => updateStrip(strip.id, patch);
  const spec = CHIPSETS[strip.chipset];
  const length = stripLength(strip);
  const active = activeCount(strip);
  const fullAmps = (strip.ledCount * spec.maFullWhite) / 1000;
  const siblings = strips.filter((s) => s.deviceId === strip.deviceId);
  const order = siblings.findIndex((s) => s.id === strip.id);
  const ddpOffset = siblings.slice(0, order).reduce((n, s) => n + s.ledCount, 0);
  const vertices = polylineVertices(strip);
  const setVertex = (i: number, v: Vec3) => set({ points: vertices.map((p, k) => (k === i ? v : p)) });

  return (
    <>
      <SectionHeader
        title={t('Segment')}
        icon={SlidersHorizontal}
        right={
          <>
            <IconButton icon={Flashlight} title={t('Identify: blink this segment for 4 s')} onClick={() => identifyStrip(strip.id)} />
            <IconButton icon={Copy} title={t('Duplicate segment')} onClick={() => duplicateStrip(strip.id)} />
            <IconButton icon={Trash} title={t('Delete segment')} danger onClick={() => del.strip(strip.id)} />
          </>
        }
      />
      <div className="flex flex-col gap-1.5 p-3">
        <Field label={t('Name')}>
          <TextInput value={strip.name} onChange={(name) => set({ name })} />
        </Field>
        <Field label={t('Device')}>
          <Select
            value={strip.deviceId}
            onChange={(deviceId) => set({ deviceId })}
            options={devices.filter((d) => d.protocol === 'DDP').map((d) => ({ value: d.id, label: d.name }))}
          />
        </Field>
        <Field label={t('Output')}>
          <span className="flex-1 font-mono text-[10px] text-zinc-400">
            {t('#{n} of {total}', { n: order + 1, total: siblings.length })} · px <span className="text-net">{ddpOffset}</span>
          </span>
          <IconButton icon={ArrowUp} title={t('Earlier in the controller’s pixel buffer')} onClick={() => moveStrip(strip.id, -1)} />
          <IconButton icon={ArrowDown} title={t('Later in the controller’s pixel buffer')} onClick={() => moveStrip(strip.id, 1)} />
        </Field>
        <Field label="GPIO">
          <ScrubInput value={strip.gpio} onChange={(gpio) => set({ gpio })} min={0} max={48} step={1} label="IO" accent="#10B981" className="flex-1" />
          <ScrubInput
            value={strip.ledCount}
            onChange={(ledCount) => set({ ledCount })}
            min={1}
            max={2000}
            step={1}
            label="N"
            accent="#06B6D4"
            className="flex-1"
            title={strip.shape === 'matrix' ? t('Set by the matrix size') : t('LEDs on the wire')}
          />
        </Field>
        <Field label={t('Chipset')}>
          <Segmented<LedChipset>
            mono
            className="flex-1"
            value={strip.chipset}
            onChange={(chipset) => set({ chipset })}
            options={[
              { value: 'WS2811', label: '2811' },
              { value: 'WS2812B', label: '2812B' },
              { value: 'WS2815', label: '2815' },
            ]}
          />
          <span className={`w-8 shrink-0 text-right font-mono text-[10px] ${spec.voltage === 12 ? 'text-gps' : 'text-net'}`}>{spec.voltage}V</span>
        </Field>

        <Subheader>{t('Geometry')}</Subheader>
        <Field label={t('Shape')}>
          <Select<StripShape> value={strip.shape} onChange={(shape) => setStripShape(strip.id, shape)} options={SHAPES.map((o) => ({ ...o, label: t(o.label) }))} />
        </Field>
        {(strip.shape === 'line' || strip.shape === 'helix') && (
          <>
            <Field label={t('Start')}>
              <Vec3Input value={strip.start} onChange={(start) => set({ start })} />
            </Field>
            <Field label={t('End')}>
              <Vec3Input value={strip.end} onChange={(end) => set({ end })} />
            </Field>
          </>
        )}
        {strip.shape === 'helix' && (
          <Field label={t('Helix')}>
            <ScrubInput
              value={strip.helixRadius}
              onChange={(helixRadius) => set({ helixRadius })}
              min={0.02}
              max={3}
              step={0.01}
              label="R"
              unit="m"
              accent="#06B6D4"
              className="flex-1"
            />
            <ScrubInput value={strip.helixTurns} onChange={(helixTurns) => set({ helixTurns })} min={0.25} max={40} step={0.05} label="T" accent="#06B6D4" className="flex-1" />
          </Field>
        )}
        {strip.shape === 'polyline' && (
          <>
            {vertices.map((v, i) => (
              <Field
                key={i}
                label={`P${i + 1}`}
                hint={vertices.length > 2 ? <IconButton icon={Minus} title={t('Remove corner')} onClick={() => set({ points: vertices.filter((_, k) => k !== i) })} /> : undefined}
              >
                <Vec3Input value={v} onChange={(p) => setVertex(i, p)} />
              </Field>
            ))}
            <button
              type="button"
              onClick={() => {
                const last = vertices[vertices.length - 1];
                set({ points: [...vertices, [last[0] + 0.5, last[1], last[2]]] });
              }}
              className="flex h-6 items-center justify-center gap-1 rounded-[5px] border border-dashed border-line text-[10px] text-zinc-400 hover:border-line-hi"
            >
              <Plus size={11} /> {t('Add corner')}
            </button>
          </>
        )}
        {strip.shape === 'arc' && (
          <>
            <Field label={t('Center')}>
              <Vec3Input value={strip.start} onChange={(start) => set({ start })} />
            </Field>
            <Field label={t('Radius')}>
              <ScrubInput value={strip.helixRadius} onChange={(helixRadius) => set({ helixRadius })} min={0.02} max={5} step={0.01} unit="m" accent="#06B6D4" className="flex-1" />
            </Field>
            <Field label={t('Normal')}>
              <Segmented<Axis>
                mono
                className="flex-1"
                value={strip.arcAxis}
                onChange={(arcAxis) => set({ arcAxis })}
                options={[
                  { value: 'x', label: 'X' },
                  { value: 'y', label: 'Y' },
                  { value: 'z', label: 'Z' },
                ]}
              />
            </Field>
            <Field label={t('Angles')}>
              <ScrubInput
                value={strip.arcStartDeg}
                onChange={(arcStartDeg) => set({ arcStartDeg })}
                min={-360}
                max={360}
                step={1}
                label={t('FROM')}
                unit="°"
                accent="#06B6D4"
                className="flex-1"
              />
              <ScrubInput
                value={strip.arcSweepDeg}
                onChange={(arcSweepDeg) => set({ arcSweepDeg })}
                min={-360}
                max={360}
                step={1}
                label={t('SWP')}
                unit="°"
                accent="#06B6D4"
                className="flex-1"
              />
            </Field>
          </>
        )}
        {strip.shape === 'matrix' && (
          <>
            <Field label={t('Corner A')}>
              <Vec3Input value={strip.start} onChange={(start) => set({ start })} />
            </Field>
            <Field label={t('Corner B')}>
              <Vec3Input value={strip.end} onChange={(end) => set({ end })} />
            </Field>
            <Field label={t('Grid')}>
              <ScrubInput
                value={strip.matrixCols}
                onChange={(matrixCols) => setMatrix(strip.id, { matrixCols })}
                min={1}
                max={128}
                step={1}
                label="COL"
                accent="#06B6D4"
                className="flex-1"
              />
              <ScrubInput
                value={strip.matrixRows}
                onChange={(matrixRows) => setMatrix(strip.id, { matrixRows })}
                min={1}
                max={128}
                step={1}
                label={t('ROW')}
                accent="#06B6D4"
                className="flex-1"
              />
            </Field>
            <Field label={t('Zig-zag')}>
              <Toggle checked={strip.serpentine} onChange={(serpentine) => setMatrix(strip.id, { serpentine })} title={t('Serpentine wiring: every other row runs backward')} />
              <span className="text-[10px] text-zinc-600">{t('Same Y on both corners = flat panel')}</span>
            </Field>
          </>
        )}
        {strip.shape === 'points' && (
          <p className="text-[10px] leading-snug text-zinc-500">
            {strip.points.length === 1
              ? t('1 imported position. Import a new CSV from the Scene header to replace it.')
              : t('{n} imported positions. Import a new CSV from the Scene header to replace them.', { n: strip.points.length })}
          </p>
        )}

        <Subheader>{t('Wiring')}</Subheader>
        <Field label={t('Direction')}>
          <Toggle checked={strip.reversed} onChange={(reversed) => set({ reversed })} title={t('Data enters at the far end of the path')} />
          <span className="text-[10px] text-zinc-500">{strip.reversed ? t('Reversed: data enters at the end') : t('Data enters at the start')}</span>
        </Field>
        <Field label={t('Skip LEDs')}>
          <ScrubInput
            value={strip.skipStart}
            onChange={(skipStart) => set({ skipStart })}
            min={0}
            max={strip.ledCount - 1}
            step={1}
            label={t('IN')}
            accent="#71717a"
            className="flex-1"
            title={t('Dark LEDs at the data input')}
          />
          <ScrubInput
            value={strip.skipEnd}
            onChange={(skipEnd) => set({ skipEnd })}
            min={0}
            max={strip.ledCount - 1}
            step={1}
            label={t('OUT')}
            accent="#71717a"
            className="flex-1"
            title={t('Dark LEDs at the far end')}
          />
        </Field>
        <Field label={t('Gain')}>
          <ScrubInput value={strip.gain} onChange={(gain) => set({ gain })} min={0} max={1} step={0.01} displayScale={100} unit="%" accent="#06B6D4" className="flex-1" />
        </Field>
        <Field label={t('Byte order')}>
          <Select<ColorOrder> mono value={strip.colorOrder} onChange={(colorOrder) => set({ colorOrder })} options={COLOR_ORDERS.map((o) => ({ value: o, label: o }))} />
        </Field>
        <p className="text-[10px] leading-snug text-zinc-600">{t('Keep RGB for WLED: it applies its own color order. Change it only for custom firmware.')}</p>

        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 rounded-[5px] border border-line bg-inset px-2 py-1.5 font-mono text-[10px] text-zinc-500">
          <span>
            {t('len')} <span className="text-zinc-300">{length.toFixed(2)} m</span>
          </span>
          <span>
            {t('dens')} <span className="text-zinc-300">{(active / Math.max(length, 0.01)).toFixed(0)} /m</span>
          </span>
          <span>
            {t('active')} <span className="text-zinc-300">{active}</span>/{strip.ledCount}
          </span>
          <span>
            I max <span className="text-gps">{fullAmps.toFixed(2)} A</span>
          </span>
          <span className="col-span-2">
            {t('DDP byte')} <span className="text-net">0x{(ddpOffset * 3).toString(16).toUpperCase().padStart(4, '0')}</span> · P max{' '}
            <span className="text-gps">{(fullAmps * spec.voltage).toFixed(1)} W</span>
          </span>
        </div>
      </div>
    </>
  );
}

function Subheader({ children, right }: { children: string; right?: React.ReactNode }) {
  return (
    <div className="mt-2 flex items-center justify-between">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">{children}</span>
      {right}
    </div>
  );
}

/** Re-read at the sensor tick (the parent re-renders with sensor values). */
function SourceStatusLine({ sensorId }: { sensorId: string }) {
  const st = sourceStatus.get(sensorId);
  if (!st) return null;
  return (
    <div className={`flex items-center gap-1.5 text-[10px] ${st.ok ? 'text-net' : 'text-amber-300'}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${st.ok ? 'bg-net' : 'bg-amber-400'}`} />
      <span className="truncate" title={st.text}>
        {st.text}
      </span>
    </div>
  );
}

function SensorSection({ sensor }: { sensor: SensorNode }) {
  const devices = useVoxel((s) => s.devices);
  const values = useVoxel((s) => s.sensorValues);
  const routes = useVoxel((s) => s.routes);
  const { updateSensor, setSensorManual, addBand, updateBand, removeBand } = useVoxelActions();
  const del = useDeleteCommands();
  const set = (patch: Partial<SensorNode>) => updateSensor(sensor.id, patch);
  const meta = KIND_META[sensor.kind];
  const source = SENSOR_SOURCES[sensor.source];
  const sources = Object.values(SENSOR_SOURCES).filter((x) => x.kinds.includes(sensor.kind));
  const channels = sensorChannels(sensor);
  const spatialRoutes = routes.filter((r) => sensorIdOf(r.source) === sensor.id && TARGET_META[r.target].spatial).length;
  const isSim = sensor.source === 'sim';
  const manual = sensor.sim.mode === 'manual' || sensor.kind === 'gpio';
  const scenarios = SCENARIOS[sensor.kind];

  return (
    <>
      <SectionHeader
        title={t('Sensor')}
        icon={KIND_ICON[sensor.kind]}
        accent={meta.color}
        right={
          <>
            <Toggle checked={sensor.enabled} onChange={(enabled) => set({ enabled })} color={meta.color} title={t('Enable sensor')} />
            <IconButton icon={Trash} title={t('Delete sensor and its routes')} danger onClick={() => void del.sensor(sensor.id)} />
          </>
        }
      />
      <div className="flex flex-col gap-1.5 p-3">
        <Field label={t('Name')}>
          <TextInput value={sensor.name} onChange={(name) => set({ name })} />
        </Field>
        <Field label={t('Type')}>
          <span className="truncate text-[11px] text-zinc-400">
            <span style={{ color: meta.color }}>{t(meta.label)}</span> · {t(meta.hardware)}
          </span>
        </Field>
        <Field label={t('Host')}>
          <Select
            value={sensor.deviceId ?? ''}
            onChange={(v) => set({ deviceId: v || null })}
            options={[{ value: '', label: t('Unhosted') }, ...devices.map((d) => ({ value: d.id, label: `${d.name} · ${d.ip}` }))]}
          />
        </Field>
        <Field label={t('Source')}>
          <Select<SensorSourceId> value={sensor.source} onChange={(v) => set({ source: v })} options={sources.map((x) => ({ value: x.id, label: t(x.label) }))} />
        </Field>
        <p className="text-[10px] leading-snug text-zinc-600">{t(source.description)}</p>
        {!isSim && <SourceStatusLine sensorId={sensor.id} />}
        {sensor.source === 'osc' && (
          <div className="flex flex-col gap-0.5 rounded-[5px] border border-line bg-inset px-2 py-1.5 font-mono text-[10px] text-zinc-400">
            {channels.map((c) => (
              <span key={c.key} className="truncate">
                {oscAddressOf(sensor.id, c.channelId)} <span className="text-zinc-600">{c.unit || '0..1'}</span>
              </span>
            ))}
          </div>
        )}

        <Subheader>{t('Placement')}</Subheader>
        <Field label={t('Position')}>
          <Vec3Input value={sensor.position} onChange={(position) => set({ position })} />
        </Field>
        <Field label={t('Radius')}>
          <ScrubInput value={sensor.radius} onChange={(radius) => set({ radius })} min={0.1} max={8} step={0.01} unit="m" accent={meta.color} className="flex-1" />
        </Field>
        <Field label={t('Falloff')}>
          <Segmented<Falloff>
            className="flex-1"
            accent={meta.color}
            value={sensor.falloff}
            onChange={(falloff) => set({ falloff })}
            options={[
              { value: 'linear', label: t('Linear') },
              { value: 'smooth', label: t('Smooth') },
              { value: 'gaussian', label: t('Gauss') },
            ]}
          />
        </Field>
        <p className="text-[10px] leading-snug text-zinc-600">
          {spatialRoutes === 1
            ? t('1 spatial route uses this position.')
            : spatialRoutes > 1
              ? t('{n} spatial routes use this position.', { n: spatialRoutes })
              : t('Position only matters for spatial routes: patch a channel to {a} or {b} in {tab} (3).', {
                  a: t(TARGET_META.local_intensity.label),
                  b: t(TARGET_META.local_wave.label),
                  tab: t('Modulation'),
                })}
        </p>

        {isSim && (
          <>
            <Subheader>{t('Simulation')}</Subheader>
            {sensor.kind !== 'gpio' && (
              <Field label={t('Mode')}>
                <Segmented
                  className="flex-1"
                  accent={meta.color}
                  value={sensor.sim.mode}
                  onChange={(mode) => set({ sim: { ...sensor.sim, mode } })}
                  options={[
                    { value: 'auto', label: t('Auto') },
                    { value: 'manual', label: t('Manual') },
                  ]}
                />
              </Field>
            )}
            {!manual && scenarios.length > 0 && (
              <Field label={t('Scenario')}>
                <Select
                  value={sensor.sim.scenario}
                  onChange={(scenario) => set({ sim: { ...sensor.sim, scenario } })}
                  options={scenarios.map((o) => ({ ...o, label: t(o.label) }))}
                />
              </Field>
            )}
            {!manual && sensor.sim.scenario === 'electro' && (
              <Field label={t('Tempo')}>
                <ScrubInput
                  value={sensor.sim.bpm}
                  onChange={(bpm) => set({ sim: { ...sensor.sim, bpm } })}
                  min={60}
                  max={180}
                  step={1}
                  unit="bpm"
                  accent={meta.color}
                  className="flex-1"
                />
              </Field>
            )}
            {manual &&
              channels.map((c) => (
                <Field key={c.key} label={t(c.label)}>
                  <ScrubInput
                    value={sensor.sim.manual[c.channelId] ?? manualDefault(c)}
                    onChange={(v) => setSensorManual(sensor.id, c.channelId, v)}
                    min={c.min}
                    max={c.max}
                    step={c.max - c.min > 10 ? 1 : 0.01}
                    unit={c.unit}
                    accent={meta.color}
                    className="flex-1"
                  />
                </Field>
              ))}
          </>
        )}

        {sensor.kind === 'audio' && (
          <>
            <Subheader right={<IconButton icon={Plus} title={t('Add band')} onClick={() => addBand(sensor.id)} />}>{t('Bands')}</Subheader>
            {sensor.bands.map((b) => (
              <div key={b.id} className="flex flex-col gap-1 rounded-[5px] border border-line bg-inset/50 p-1.5">
                <div className="flex items-center gap-1">
                  <TextInput value={b.label} onChange={(label) => updateBand(sensor.id, b.id, { label })} />
                  <span className="tabular w-10 shrink-0 text-right font-mono text-[10px]" style={{ color: meta.color }}>
                    {(values[`${sensor.id}.${b.id}`] ?? 0).toFixed(2)}
                  </span>
                  <IconButton icon={Trash} title={t('Delete band and its routes')} danger onClick={() => removeBand(sensor.id, b.id)} />
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <ScrubInput
                    label={t('LO')}
                    value={b.lowHz}
                    onChange={(lowHz) => updateBand(sensor.id, b.id, { lowHz: Math.min(lowHz, b.highHz) })}
                    min={20}
                    max={16000}
                    step={5}
                    unit="Hz"
                    accent={meta.color}
                  />
                  <ScrubInput
                    label={t('HI')}
                    value={b.highHz}
                    onChange={(highHz) => updateBand(sensor.id, b.id, { highHz: Math.max(highHz, b.lowHz) })}
                    min={20}
                    max={16000}
                    step={5}
                    unit="Hz"
                    accent={meta.color}
                  />
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <ScrubInput
                    label="G"
                    value={b.gain}
                    onChange={(gain) => updateBand(sensor.id, b.id, { gain })}
                    min={0}
                    max={8}
                    step={0.05}
                    accent={meta.color}
                    title={t('Gain')}
                  />
                  <ScrubInput
                    label="A"
                    value={b.attackMs}
                    onChange={(attackMs) => updateBand(sensor.id, b.id, { attackMs })}
                    min={1}
                    max={500}
                    step={1}
                    unit="ms"
                    accent={meta.color}
                    title={t('Attack')}
                  />
                  <ScrubInput
                    label="R"
                    value={b.releaseMs}
                    onChange={(releaseMs) => updateBand(sensor.id, b.id, { releaseMs })}
                    min={5}
                    max={2000}
                    step={5}
                    unit="ms"
                    accent={meta.color}
                    title={t('Release')}
                  />
                </div>
              </div>
            ))}
          </>
        )}

        <Subheader>{t('Live output')}</Subheader>
        <div className="flex flex-col gap-0.5 rounded-[5px] border border-line bg-inset px-2 py-1.5 font-mono text-[10px]">
          {channels.map((c) => {
            const v = values[c.key] ?? 0;
            return (
              <div key={c.key} className="flex justify-between">
                <span className="text-zinc-500">{c.key}</span>
                <span style={{ color: meta.color }}>
                  {v.toFixed(3)}
                  {c.unit && (
                    <span className="text-zinc-500">
                      {' '}
                      · {denormalize(c, v).toFixed(1)} {c.unit}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export function InspectorSidebar() {
  const strip = useVoxel((s) => s.strips.find((x) => x.id === s.selectedStripId) ?? null);
  const sensor = useVoxel((s) => s.sensors.find((x) => x.id === s.selectedSensorId) ?? null);
  return (
    <aside className="flex w-[296px] shrink-0 flex-col overflow-y-auto border-l border-line bg-panel">
      <EffectSection />
      <div className="border-t border-line">
        {sensor ? (
          <SensorSection sensor={sensor} />
        ) : strip ? (
          <SegmentSection strip={strip} />
        ) : (
          <div className="p-4 text-[11px] text-zinc-600">{t('Select a segment or a sensor in the scene tree, or click it in the viewport.')}</div>
        )}
      </div>
    </aside>
  );
}
