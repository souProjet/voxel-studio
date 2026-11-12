import { Cpu, Cuboid, Radio, ScanLine, Tablet, Workflow } from 'lucide-react';
import type { ViewId } from '../../types/voxel';
import { useVoxel, useVoxelActions } from '../../state/useVoxelStore';
import { bridgeMode } from '../../services/tauriBridge';
import { denormalize, sensorChannels } from '../../services/sensors';

const TABS: { id: ViewId; label: string; key: string; icon: typeof Cuboid }[] = [
  { id: 'studio', label: 'Studio 3D', key: '1', icon: Cuboid },
  { id: 'scanner', label: 'Scanner', key: '2', icon: ScanLine },
  { id: 'patcher', label: 'Modulation', key: '3', icon: Workflow },
  { id: 'devices', label: 'Fleet', key: '4', icon: Cpu },
  { id: 'livepad', label: 'Live Pad', key: '5', icon: Tablet },
];

export const VIEW_ORDER = TABS.map((t) => t.id);

function AudioMeter() {
  const mic = useVoxel((s) => s.sensors.find((x) => x.kind === 'audio' && x.enabled) ?? null);
  const values = useVoxel((s) => s.sensorValues);
  const channels = mic ? sensorChannels(mic).slice(0, 3) : [];
  const levels = channels.map((c) => values[c.key] ?? 0);
  return (
    <div className="flex items-center gap-1.5" title={mic ? `${mic.name}: ${channels.map((c) => c.label).join(' / ')}` : 'No audio sensor'}>
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">FFT</span>
      <div className="flex h-4 items-end gap-[2px]">
        {levels.map((v, i) => (
          <div key={i} className="relative h-full w-1.5 overflow-hidden rounded-[1px] bg-line">
            <div className="absolute inset-x-0 bottom-0 bg-audio" style={{ height: `${Math.round(v * 100)}%`, opacity: 0.55 + v * 0.45 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TopHeader() {
  const view = useVoxel((s) => s.view);
  const stats = useVoxel((s) => s.stats);
  const gpsSensor = useVoxel((s) => s.sensors.find((x) => x.kind === 'gps' && x.enabled) ?? null);
  const gpsValue = useVoxel((s) => (gpsSensor ? s.sensorValues[`${gpsSensor.id}.speed`] ?? 0 : 0));
  const gps = gpsSensor ? denormalize(sensorChannels(gpsSensor)[0], gpsValue) : 0;
  const ddpOutput = useVoxel((s) => s.ddpOutput);
  const { setView, toggle } = useVoxelActions();

  return (
    <header className="flex h-10 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <div className="flex items-center gap-2 pr-2">
        <div className="grid h-5 w-5 grid-cols-2 gap-[2px]">
          <span className="rounded-[1px] bg-spatial" />
          <span className="rounded-[1px] bg-zinc-700" />
          <span className="rounded-[1px] bg-zinc-700" />
          <span className="rounded-[1px] bg-audio" />
        </div>
        <span className="font-mono text-[11px] font-semibold tracking-[0.18em] text-zinc-100">
          VOXEL <span className="text-zinc-600">//</span> STUDIO
        </span>
      </div>

      <nav className="flex h-full items-stretch">
        {TABS.map((t) => {
          const on = view === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setView(t.id)}
              title={`${t.label} (${t.key})`}
              className={`relative flex items-center gap-1.5 px-3 text-[11px] font-medium transition-colors ${on ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              <t.icon size={13} strokeWidth={1.75} className={on ? 'text-spatial' : ''} />
              {t.label}
              <span className="font-mono text-[9px] text-zinc-600">{t.key}</span>
              {on && <span className="absolute inset-x-2 bottom-0 h-px bg-spatial" />}
            </button>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-4">
        <button
          type="button"
          onClick={() => toggle('ddpOutput')}
          title={ddpOutput ? 'DDP output live: click to blackout network output' : 'DDP output paused'}
          className={`flex h-6 items-center gap-1.5 rounded-[5px] border px-2 font-mono text-[10px] transition-colors ${
            ddpOutput ? 'border-net/40 bg-net/10 text-net' : 'border-line text-zinc-500'
          }`}
        >
          <Radio size={11} strokeWidth={2} />
          DDP {stats.ddpFps.toFixed(0).padStart(2, '0')} FPS
        </button>
        <div className="flex items-baseline gap-1">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Voxels</span>
          <span className="tabular font-mono text-[11px] text-spatial">{stats.activeVoxels}</span>
        </div>
        <AudioMeter />
        <div className="flex items-baseline gap-1">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">GPS</span>
          <span className="tabular font-mono text-[11px] text-gps">{gps.toFixed(0).padStart(3, '0')}</span>
          <span className="font-mono text-[10px] text-zinc-500">km/h</span>
        </div>
        <div className="flex items-baseline gap-1" title="Render loop frame rate">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">GL</span>
          <span className="tabular font-mono text-[11px] text-zinc-300">{stats.renderFps.toFixed(0)}</span>
        </div>
        <span
          className={`rounded-[4px] border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
            bridgeMode === 'native' ? 'border-net/40 text-net' : 'border-line text-zinc-500'
          }`}
          title={bridgeMode === 'native' ? 'Tauri: real UDP sockets' : 'Browser: UDP is simulated'}
        >
          {bridgeMode === 'native' ? 'Native UDP' : 'Web Sim'}
        </span>
      </div>
    </header>
  );
}
