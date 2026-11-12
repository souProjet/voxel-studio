import { Crosshair, Minus, Plus, SlidersHorizontal, Spline, Trash } from 'lucide-react';
import type { Falloff, LEDStrip, LedChipset, SensorNode, SensorSourceId, Vec3 } from '../../types/voxel';
import { useVoxel, useVoxelActions } from '../../state/useVoxelStore';
import { CHIPSETS, KIND_META, SCENARIOS, SHADER_PRESETS, TARGET_META } from '../../services/catalog';
import { stripLength } from '../../services/geometry';
import { denormalize, manualDefault, SENSOR_SOURCES, sensorChannels, sensorIdOf } from '../../services/sensors';
import { ScrubInput } from '../ui/ScrubInput';
import { Field, IconButton, SectionHeader, Segmented, Select, TextInput, Toggle } from '../ui/primitives';
import { KIND_ICON } from '../ui/sensorIcons';

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

function EffectSection() {
  const params = useVoxel((s) => s.params);
  const shader = useVoxel((s) => s.shader);
  const stats = useVoxel((s) => s.stats);
  const { setParams, setOriginAxis } = useVoxelActions();
  const preset = SHADER_PRESETS.find((p) => p.id === shader)!;

  return (
    <>
      <SectionHeader title="Effect" icon={Crosshair} right={<span className="font-mono text-[10px] text-spatial">{preset.short}</span>} />
      <div className="flex flex-col gap-1.5 p-3">
        <p className="text-[11px] leading-snug text-zinc-500">{preset.description}</p>
        <div className="mt-1 text-[10px] uppercase tracking-wider text-zinc-500">Origin</div>
        <div className="grid grid-cols-3 gap-1">
          <ScrubInput axis="x" label="X" value={params.origin[0]} onChange={(v) => setOriginAxis(0, v)} min={-3.5} max={3.5} step={0.01} unit="m" />
          <ScrubInput axis="y" label="Y" value={params.origin[1]} onChange={(v) => setOriginAxis(1, v)} min={0} max={2.4} step={0.01} unit="m" />
          <ScrubInput axis="z" label="Z" value={params.origin[2]} onChange={(v) => setOriginAxis(2, v)} min={-2.5} max={2.5} step={0.01} unit="m" />
        </div>
        <Field label="Radius">
          <ScrubInput value={params.radius} onChange={(radius) => setParams({ radius })} min={0.05} max={6} step={0.01} unit="m" accent="#06B6D4" modulated={stats.effectiveRadius} className="flex-1" />
        </Field>
        <Field label="Speed">
          <ScrubInput value={params.speed} onChange={(speed) => setParams({ speed })} min={0} max={6} step={0.01} unit="x" accent="#06B6D4" modulated={stats.effectiveSpeed} className="flex-1" />
        </Field>
        <Field label="Hue shift">
          <ScrubInput value={params.hueShift} onChange={(hueShift) => setParams({ hueShift })} min={0} max={1} step={0.005} precision={3} unit="turn" accent="#06B6D4" modulated={stats.effectiveHueShift} className="flex-1" />
        </Field>
        <Field label="Master">
          <ScrubInput value={params.masterBrightness} onChange={(masterBrightness) => setParams({ masterBrightness })} min={0} max={1} step={0.01} displayScale={100} unit="%" accent="#06B6D4" modulated={stats.effectiveBrightness} className="flex-1" />
        </Field>
        <div className="mt-1 grid grid-cols-3 gap-1 rounded-[5px] border border-line bg-inset px-2 py-1.5 font-mono text-[10px]">
          <span className="text-zinc-500">
            r <span className="text-audio">{stats.effectiveRadius.toFixed(2)}</span>
          </span>
          <span className="text-zinc-500">
            spd <span className="text-audio">{stats.effectiveSpeed.toFixed(2)}</span>
          </span>
          <span className="text-zinc-500">
            hue <span className="text-audio">{stats.effectiveHueShift.toFixed(2)}</span>
          </span>
        </div>
      </div>
    </>
  );
}

function SegmentSection({ strip }: { strip: LEDStrip }) {
  const devices = useVoxel((s) => s.devices);
  const strips = useVoxel((s) => s.strips);
  const { updateStrip, removeStrip } = useVoxelActions();
  const set = (patch: Partial<LEDStrip>) => updateStrip(strip.id, patch);
  const spec = CHIPSETS[strip.chipset];
  const length = stripLength(strip);
  const fullAmps = (strip.ledCount * spec.maFullWhite) / 1000;
  let ddpOffset = 0;
  for (const s of strips) {
    if (s.id === strip.id) break;
    if (s.deviceId === strip.deviceId) ddpOffset += s.ledCount;
  }

  return (
    <>
      <SectionHeader
        title="Segment"
        icon={SlidersHorizontal}
        right={<IconButton icon={Trash} title="Delete segment" danger onClick={() => removeStrip(strip.id)} />}
      />
      <div className="flex flex-col gap-1.5 p-3">
        <Field label="Name">
          <TextInput value={strip.name} onChange={(name) => set({ name })} />
        </Field>
        <Field label="Device">
          <Select
            value={strip.deviceId}
            onChange={(deviceId) => set({ deviceId })}
            options={devices.filter((d) => d.protocol === 'DDP').map((d) => ({ value: d.id, label: d.name }))}
          />
        </Field>
        <Field label="GPIO">
          <ScrubInput value={strip.gpio} onChange={(gpio) => set({ gpio })} min={0} max={48} step={1} label="IO" accent="#10B981" className="flex-1" />
          <ScrubInput value={strip.ledCount} onChange={(ledCount) => set({ ledCount })} min={1} max={2000} step={1} label="N" accent="#06B6D4" className="flex-1" />
        </Field>
        <Field label="Chipset">
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
        <Field label="Shape">
          <Segmented
            className="flex-1"
            value={strip.shape}
            onChange={(shape) => set({ shape })}
            options={[
              { value: 'line', label: 'Line', icon: Minus },
              { value: 'helix', label: 'Helix', icon: Spline },
            ]}
          />
        </Field>
        <Field label="Start">
          <Vec3Input value={strip.start} onChange={(start) => set({ start })} />
        </Field>
        <Field label="End">
          <Vec3Input value={strip.end} onChange={(end) => set({ end })} />
        </Field>
        {strip.shape === 'helix' && (
          <Field label="Helix">
            <ScrubInput value={strip.helixRadius} onChange={(helixRadius) => set({ helixRadius })} min={0.02} max={3} step={0.01} label="R" unit="m" accent="#06B6D4" className="flex-1" />
            <ScrubInput value={strip.helixTurns} onChange={(helixTurns) => set({ helixTurns })} min={0.25} max={40} step={0.05} label="T" accent="#06B6D4" className="flex-1" />
          </Field>
        )}
        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 rounded-[5px] border border-line bg-inset px-2 py-1.5 font-mono text-[10px] text-zinc-500">
          <span>
            len <span className="text-zinc-300">{length.toFixed(2)} m</span>
          </span>
          <span>
            dens <span className="text-zinc-300">{(strip.ledCount / Math.max(length, 0.01)).toFixed(0)} /m</span>
          </span>
          <span>
            I max <span className="text-gps">{fullAmps.toFixed(2)} A</span>
          </span>
          <span>
            P max <span className="text-gps">{(fullAmps * spec.voltage).toFixed(1)} W</span>
          </span>
          <span className="col-span-2">
            DDP px <span className="text-net">{ddpOffset}</span> · byte <span className="text-net">0x{(ddpOffset * 3).toString(16).toUpperCase().padStart(4, '0')}</span>
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

function SensorSection({ sensor }: { sensor: SensorNode }) {
  const devices = useVoxel((s) => s.devices);
  const values = useVoxel((s) => s.sensorValues);
  const routes = useVoxel((s) => s.routes);
  const { updateSensor, removeSensor, setSensorManual, addBand, updateBand, removeBand } = useVoxelActions();
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
        title="Sensor"
        icon={KIND_ICON[sensor.kind]}
        accent={meta.color}
        right={
          <>
            <Toggle checked={sensor.enabled} onChange={(enabled) => set({ enabled })} color={meta.color} title="Enable sensor" />
            <IconButton icon={Trash} title="Delete sensor and its routes" danger onClick={() => removeSensor(sensor.id)} />
          </>
        }
      />
      <div className="flex flex-col gap-1.5 p-3">
        <Field label="Name">
          <TextInput value={sensor.name} onChange={(name) => set({ name })} />
        </Field>
        <Field label="Type">
          <span className="truncate text-[11px] text-zinc-400">
            <span style={{ color: meta.color }}>{meta.label}</span> · {meta.hardware}
          </span>
        </Field>
        <Field label="Host">
          <Select
            value={sensor.deviceId ?? ''}
            onChange={(v) => set({ deviceId: v || null })}
            options={[{ value: '', label: 'Unhosted' }, ...devices.map((d) => ({ value: d.id, label: `${d.name} · ${d.ip}` }))]}
          />
        </Field>
        <Field label="Source">
          <Select<SensorSourceId> value={sensor.source} onChange={(v) => set({ source: v })} options={sources.map((x) => ({ value: x.id, label: x.label }))} />
        </Field>
        <p className="text-[10px] leading-snug text-zinc-600">{source.description}</p>

        <Subheader>Placement</Subheader>
        <Field label="Position">
          <Vec3Input value={sensor.position} onChange={(position) => set({ position })} />
        </Field>
        <Field label="Radius">
          <ScrubInput value={sensor.radius} onChange={(radius) => set({ radius })} min={0.1} max={8} step={0.01} unit="m" accent={meta.color} className="flex-1" />
        </Field>
        <Field label="Falloff">
          <Segmented<Falloff>
            className="flex-1"
            accent={meta.color}
            value={sensor.falloff}
            onChange={(falloff) => set({ falloff })}
            options={[
              { value: 'linear', label: 'Linear' },
              { value: 'smooth', label: 'Smooth' },
              { value: 'gaussian', label: 'Gauss' },
            ]}
          />
        </Field>
        <p className="text-[10px] leading-snug text-zinc-600">
          {spatialRoutes > 0
            ? `${spatialRoutes} spatial route${spatialRoutes > 1 ? 's' : ''} use this position.`
            : 'Position only matters for spatial routes: patch a channel to Local Intensity or Local Wave in Modulation (3).'}
        </p>

        {isSim && (
          <>
            <Subheader>Simulation</Subheader>
            {sensor.kind !== 'gpio' && (
              <Field label="Mode">
                <Segmented
                  className="flex-1"
                  accent={meta.color}
                  value={sensor.sim.mode}
                  onChange={(mode) => set({ sim: { ...sensor.sim, mode } })}
                  options={[
                    { value: 'auto', label: 'Auto' },
                    { value: 'manual', label: 'Manual' },
                  ]}
                />
              </Field>
            )}
            {!manual && scenarios.length > 0 && (
              <Field label="Scenario">
                <Select
                  value={sensor.sim.scenario}
                  onChange={(scenario) => set({ sim: { ...sensor.sim, scenario } })}
                  options={scenarios}
                />
              </Field>
            )}
            {!manual && sensor.sim.scenario === 'electro' && (
              <Field label="Tempo">
                <ScrubInput value={sensor.sim.bpm} onChange={(bpm) => set({ sim: { ...sensor.sim, bpm } })} min={60} max={180} step={1} unit="bpm" accent={meta.color} className="flex-1" />
              </Field>
            )}
            {manual &&
              channels.map((c) => (
                <Field key={c.key} label={c.label}>
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
            <Subheader right={<IconButton icon={Plus} title="Add band" onClick={() => addBand(sensor.id)} />}>Bands</Subheader>
            {sensor.bands.map((b) => (
              <div key={b.id} className="flex flex-col gap-1 rounded-[5px] border border-line bg-inset/50 p-1.5">
                <div className="flex items-center gap-1">
                  <TextInput value={b.label} onChange={(label) => updateBand(sensor.id, b.id, { label })} />
                  <span className="tabular w-10 shrink-0 text-right font-mono text-[10px]" style={{ color: meta.color }}>
                    {(values[`${sensor.id}.${b.id}`] ?? 0).toFixed(2)}
                  </span>
                  <IconButton icon={Trash} title="Delete band and its routes" danger onClick={() => removeBand(sensor.id, b.id)} />
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <ScrubInput label="LO" value={b.lowHz} onChange={(lowHz) => updateBand(sensor.id, b.id, { lowHz: Math.min(lowHz, b.highHz) })} min={20} max={16000} step={5} unit="Hz" accent={meta.color} />
                  <ScrubInput label="HI" value={b.highHz} onChange={(highHz) => updateBand(sensor.id, b.id, { highHz: Math.max(highHz, b.lowHz) })} min={20} max={16000} step={5} unit="Hz" accent={meta.color} />
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <ScrubInput label="G" value={b.gain} onChange={(gain) => updateBand(sensor.id, b.id, { gain })} min={0} max={8} step={0.05} accent={meta.color} title="Gain" />
                  <ScrubInput label="A" value={b.attackMs} onChange={(attackMs) => updateBand(sensor.id, b.id, { attackMs })} min={1} max={500} step={1} unit="ms" accent={meta.color} title="Attack" />
                  <ScrubInput label="R" value={b.releaseMs} onChange={(releaseMs) => updateBand(sensor.id, b.id, { releaseMs })} min={5} max={2000} step={5} unit="ms" accent={meta.color} title="Release" />
                </div>
              </div>
            ))}
          </>
        )}

        <Subheader>Live output</Subheader>
        <div className="flex flex-col gap-0.5 rounded-[5px] border border-line bg-inset px-2 py-1.5 font-mono text-[10px]">
          {channels.map((c) => {
            const v = values[c.key] ?? 0;
            return (
              <div key={c.key} className="flex justify-between">
                <span className="text-zinc-500">{c.key}</span>
                <span style={{ color: meta.color }}>
                  {v.toFixed(3)}
                  {c.unit && <span className="text-zinc-500"> · {denormalize(c, v).toFixed(1)} {c.unit}</span>}
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
          <div className="p-4 text-[11px] text-zinc-600">Select a segment or a sensor in the scene tree, or click it in the viewport.</div>
        )}
      </div>
    </aside>
  );
}
