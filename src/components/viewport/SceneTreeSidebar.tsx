import { useMemo, useState } from 'react';
import {
  Activity,
  Braces,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  FileDown,
  FileUp,
  Grid3x3,
  Layers,
  Minus,
  Plus,
  Radar,
  Spline,
  Trash,
  Waypoints,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { SensorKind, StripShape } from '../../types/voxel';
import { useVoxel, useVoxelActions, useVoxelStoreRef, totalLeds } from '../../state/useVoxelStore';
import { useDeleteCommands } from '../../state/useDeleteCommands';
import { exportMappingCsv, exportMappingJson, parsePointsCsv } from '../../services/mappingIO';
import { exportTextFile, pickTextFile } from '../../services/tauriBridge';
import { KIND_META, MAX_LEDS } from '../../services/catalog';
import { denormalize, sensorChannels } from '../../services/sensors';
import { IconButton, SectionHeader, SliderBar } from '../ui/primitives';
import { t } from '../../i18n';
import { KIND_ICON } from '../ui/sensorIcons';

const SHAPE_ICON: Record<StripShape, LucideIcon> = {
  line: Minus,
  helix: Spline,
  polyline: Waypoints,
  arc: CircleDashed,
  matrix: Grid3x3,
  points: Activity,
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function StripTree() {
  const strips = useVoxel((s) => s.strips);
  const devices = useVoxel((s) => s.devices);
  const selectedId = useVoxel((s) => s.selectedStripId);
  const store = useVoxelStoreRef();
  const { selectStrip, updateStrip, addStrip, duplicateStrip, addPointsStrip, notify } = useVoxelActions();
  const del = useDeleteCommands();

  const exportMapping = async (kind: 'csv' | 'json') => {
    const st = store.getState();
    const body = kind === 'csv' ? exportMappingCsv(st.strips, st.devices) : exportMappingJson(st.strips, st.devices);
    try {
      const name = await exportTextFile(body, `${st.projectName || 'mapping'}-mapping.${kind}`, kind);
      if (name) notify(t('Exported {name}', { name }));
    } catch (e) {
      notify(t('Export failed: {error}', { error: errorText(e) }), 'error');
    }
  };

  const importPoints = async () => {
    const file = await pickTextFile('.csv,.tsv,.txt,text/csv');
    if (!file) return;
    try {
      const parsed = parsePointsCsv(file.contents);
      const st = store.getState();
      const device = st.devices.find((d) => d.id === st.strips.find((x) => x.id === st.selectedStripId)?.deviceId) ?? st.devices.find((d) => d.protocol === 'DDP');
      if (!device) throw new Error(t('Add a DDP controller first.'));
      const free = MAX_LEDS - totalLeds(st.strips);
      addPointsStrip(file.name.replace(/\.[^.]+$/, ''), parsed.points, device.id);
      const skipped = parsed.skippedLines;
      const notes = [
        parsed.convertedFromMm ? t('converted from mm') : '',
        skipped ? (skipped === 1 ? t('1 line skipped') : t('{n} lines skipped', { n: skipped })) : '',
        parsed.points.length > free ? t('truncated to {n} (LED budget)', { n: free }) : '',
      ].filter(Boolean);
      const n = Math.min(parsed.points.length, free);
      const summary = n === 1 ? t('Imported 1 point on {name}', { name: device.name }) : t('Imported {n} points on {name}', { n, name: device.name });
      notify(notes.length ? `${summary} (${notes.join(', ')})` : summary);
    } catch (e) {
      notify(t('Import failed: {error}', { error: errorText(e) }), 'error');
    }
  };
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const used = totalLeds(strips);

  const groups = useMemo(
    () => devices.map((d) => ({ device: d, strips: strips.filter((s) => s.deviceId === d.id) })).filter((g) => g.strips.length > 0 || g.device.protocol === 'DDP'),
    [devices, strips],
  );

  return (
    <>
      <SectionHeader
        title={t('Scene')}
        icon={Layers}
        right={
          <>
            <span className="tabular font-mono text-[10px] text-zinc-500">
              {used}/{MAX_LEDS}
            </span>
            <IconButton icon={FileUp} title={t('Import LED positions from CSV (x, y, z per line)')} onClick={importPoints} />
            <IconButton icon={FileDown} title={t('Export mapping as CSV')} onClick={() => exportMapping('csv')} />
            <IconButton icon={Braces} title={t('Export mapping as JSON')} onClick={() => exportMapping('json')} />
            <IconButton icon={Plus} title={t('Add LED segment')} onClick={addStrip} />
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {groups.map(({ device, strips: list }) => {
          const open = !collapsed[device.id];
          const count = list.reduce((n, s) => n + s.ledCount, 0);
          return (
            <div key={device.id}>
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [device.id]: open }))}
                className="flex h-7 w-full items-center gap-1.5 px-2 text-left hover:bg-card/60"
              >
                {open ? <ChevronDown size={12} className="text-zinc-600" /> : <ChevronRight size={12} className="text-zinc-600" />}
                <Cpu size={12} strokeWidth={1.75} className="text-zinc-500" />
                <span className="truncate text-[11px] font-medium text-zinc-300">{device.name}</span>
                <span className="tabular ml-auto font-mono text-[10px] text-zinc-600">{count}</span>
              </button>
              {open &&
                list.map((s) => {
                  const on = s.id === selectedId;
                  return (
                    <div
                      key={s.id}
                      onClick={() => selectStrip(s.id)}
                      className={`group relative flex h-7 cursor-pointer items-center gap-1.5 pl-7 pr-1.5 ${on ? 'bg-card text-zinc-100' : 'text-zinc-400 hover:bg-card/50'}`}
                    >
                      {on && <span className="absolute inset-y-1 left-0 w-0.5 rounded-r bg-spatial" />}
                      {(() => {
                        const Icon = SHAPE_ICON[s.shape];
                        return <Icon size={12} strokeWidth={1.75} className={on ? 'text-spatial' : 'text-zinc-600'} />;
                      })()}
                      <span className={`truncate text-[11px] ${s.visible ? '' : 'text-zinc-600 line-through'}`}>{s.name}</span>
                      <span className="tabular ml-auto shrink-0 font-mono text-[10px] text-zinc-600">
                        G{s.gpio}·{s.ledCount}
                      </span>
                      <div className="flex shrink-0 items-center opacity-60 group-hover:opacity-100">
                        <IconButton
                          icon={s.visible ? Eye : EyeOff}
                          title={s.visible ? t('Hide (outputs black)') : t('Show')}
                          onClick={() => updateStrip(s.id, { visible: !s.visible })}
                        />
                        <IconButton icon={Copy} title={t('Duplicate')} onClick={() => duplicateStrip(s.id)} />
                        <IconButton icon={Trash} title={t('Delete segment')} danger onClick={() => del.strip(s.id)} />
                      </div>
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </>
  );
}

const KINDS: SensorKind[] = ['audio', 'gps', 'gpio', 'gyro'];

function SensorTree() {
  const sensors = useVoxel((s) => s.sensors);
  const devices = useVoxel((s) => s.devices);
  const selectedId = useVoxel((s) => s.selectedSensorId);
  const { selectSensor, updateSensor, addSensor } = useVoxelActions();
  const del = useDeleteCommands();

  return (
    <div className="flex max-h-[34%] shrink-0 flex-col border-t border-line">
      <SectionHeader
        title={t('Sensors')}
        icon={Radar}
        right={KINDS.map((k) => (
          <IconButton key={k} icon={KIND_ICON[k]} title={t('Add {kind} sensor', { kind: t(KIND_META[k].label) })} onClick={() => addSensor(k)} />
        ))}
      />
      <div className="min-h-0 overflow-y-auto py-1">
        {sensors.length === 0 && <p className="px-3 py-2 text-[11px] text-zinc-600">{t('No sensors. Add one with the buttons above.')}</p>}
        {sensors.map((x) => {
          const on = x.id === selectedId;
          const Icon = KIND_ICON[x.kind];
          const color = KIND_META[x.kind].color;
          const host = devices.find((d) => d.id === x.deviceId);
          return (
            <div
              key={x.id}
              onClick={() => selectSensor(x.id)}
              className={`group relative flex h-7 cursor-pointer items-center gap-1.5 pl-3 pr-1.5 ${on ? 'bg-card text-zinc-100' : 'text-zinc-400 hover:bg-card/50'}`}
            >
              {on && <span className="absolute inset-y-1 left-0 w-0.5 rounded-r" style={{ background: color }} />}
              <Icon size={12} strokeWidth={1.75} style={{ color: x.enabled ? color : '#52525b' }} />
              <span className={`truncate text-[11px] ${x.enabled ? '' : 'text-zinc-600 line-through'}`}>{x.name}</span>
              <span className="ml-auto max-w-[64px] shrink-0 truncate font-mono text-[9px] text-zinc-600">{host ? host.ip : t('unhosted')}</span>
              <div className="flex shrink-0 items-center opacity-60 group-hover:opacity-100">
                <IconButton icon={x.visible ? Eye : EyeOff} title={x.visible ? t('Hide gizmo') : t('Show gizmo')} onClick={() => updateSensor(x.id, { visible: !x.visible })} />
                <IconButton icon={Trash} title={t('Delete sensor and its routes')} danger onClick={() => void del.sensor(x.id)} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SensorMonitor() {
  const sensors = useVoxel((s) => s.sensors);
  const values = useVoxel((s) => s.sensorValues);
  const strobe = useVoxel((s) => s.stats.strobeActive);
  const { setSensorManual, selectSensor } = useVoxelActions();

  return (
    <div className="flex max-h-[40%] shrink-0 flex-col border-t border-line">
      <SectionHeader title={t('Sensor Monitor')} icon={Activity} right={strobe && <span className="font-mono text-[9px] text-net">{t('STROBE')}</span>} />
      <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto p-3">
        {sensors
          .filter((x) => x.enabled)
          .map((x) => {
            const color = KIND_META[x.kind].color;
            const editable = x.source === 'sim' && (x.sim.mode === 'manual' || x.kind === 'gpio');
            const channels = sensorChannels(x);
            return (
              <div key={x.id} className="flex flex-col gap-1">
                <button type="button" onClick={() => selectSensor(x.id)} className="flex items-center justify-between text-left">
                  <span className="truncate text-[11px] text-zinc-400 hover:text-zinc-200">{x.name}</span>
                  <span className="shrink-0 font-mono text-[9px] uppercase text-zinc-600">
                    {x.source === 'sim' ? (x.kind === 'gpio' ? t('momentary') : x.sim.mode === 'manual' ? t('Manual') : t('Auto')) : x.source}
                  </span>
                </button>
                {x.kind === 'gpio' ? (
                  <button
                    type="button"
                    disabled={!editable}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setSensorManual(x.id, 'pressed', 1);
                    }}
                    onPointerUp={() => setSensorManual(x.id, 'pressed', 0)}
                    onPointerCancel={() => setSensorManual(x.id, 'pressed', 0)}
                    className={`flex h-8 items-center justify-center gap-2 rounded-[5px] border font-mono text-[10px] tracking-wider transition-colors ${
                      (values[channels[0].key] ?? 0) > 0.5 ? 'border-net bg-net/20 text-net' : 'border-line bg-inset text-zinc-400 hover:border-line-hi'
                    }`}
                  >
                    <Zap size={12} strokeWidth={2} />
                    {t('HOLD')} · {x.name.toUpperCase()}
                  </button>
                ) : (
                  channels.map((c) => {
                    const v = values[c.key] ?? 0;
                    const raw = denormalize(c, v);
                    return (
                      <div key={c.key} className="flex items-center gap-1.5">
                        <span className="w-10 shrink-0 truncate font-mono text-[10px] text-zinc-500">{t(c.label)}</span>
                        <SliderBar
                          value={v}
                          color={color}
                          bipolar={c.min < 0}
                          height="h-4"
                          onChange={editable ? (n) => setSensorManual(x.id, c.channelId, +denormalize(c, n).toFixed(2)) : undefined}
                        />
                        <span className="tabular w-14 shrink-0 text-right font-mono text-[10px]" style={{ color }}>
                          {c.unit ? `${raw.toFixed(0)} ${c.unit}` : raw.toFixed(2)}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

export function SceneTreeSidebar() {
  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r border-line bg-panel">
      <StripTree />
      <SensorTree />
      <SensorMonitor />
    </aside>
  );
}
