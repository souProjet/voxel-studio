import { Cpu, Cuboid, FilePlus, FolderOpen, Moon, OctagonX, Radio, Redo2, Save, ScanLine, Tablet, Undo2, Workflow } from 'lucide-react';
import type { ViewId } from '../../types/voxel';
import { useVoxel, useVoxelActions } from '../../state/useVoxelStore';
import { bridgeMode } from '../../services/tauriBridge';
import { denormalize, sensorChannels } from '../../services/sensors';
import { useProjectCommands } from '../../state/useProjectCommands';
import { IconButton, Segmented } from './primitives';
import { setLang, t, tk, useLang, type Lang } from '../../i18n';

const TABS: { id: ViewId; label: string; key: string; icon: typeof Cuboid }[] = [
  { id: 'studio', label: tk('Studio 3D'), key: '1', icon: Cuboid },
  { id: 'scanner', label: tk('Scanner'), key: '2', icon: ScanLine },
  { id: 'patcher', label: tk('Modulation'), key: '3', icon: Workflow },
  { id: 'devices', label: tk('Fleet'), key: '4', icon: Cpu },
  { id: 'livepad', label: tk('Live Pad'), key: '5', icon: Tablet },
];

export const VIEW_ORDER = TABS.map((t) => t.id);

function AudioMeter() {
  const mic = useVoxel((s) => s.sensors.find((x) => x.kind === 'audio' && x.enabled) ?? null);
  const values = useVoxel((s) => s.sensorValues);
  const channels = mic ? sensorChannels(mic).slice(0, 3) : [];
  const levels = channels.map((c) => values[c.key] ?? 0);
  return (
    <div className="flex items-center gap-1.5" title={mic ? `${mic.name}: ${channels.map((c) => c.label).join(' / ')}` : t('No audio sensor')}>
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

function ProjectControls() {
  const name = useVoxel((s) => s.projectName);
  const dirty = useVoxel((s) => s.dirty);
  const canUndo = useVoxel((s) => s.canUndo);
  const canRedo = useVoxel((s) => s.canRedo);
  const { undo, redo } = useVoxelActions();
  const cmd = useProjectCommands();
  return (
    <div className="flex items-center gap-0.5 border-l border-line pl-2">
      <IconButton icon={FilePlus} title={t('New project')} onClick={cmd.newProject} />
      <IconButton icon={FolderOpen} title={t('Open project (Cmd/Ctrl+O)')} onClick={cmd.open} />
      <IconButton icon={Save} title={t('Save project (Cmd/Ctrl+S)')} onClick={cmd.save} />
      <span className={canUndo ? '' : 'pointer-events-none opacity-30'}>
        <IconButton icon={Undo2} title={t('Undo (Cmd/Ctrl+Z)')} onClick={undo} />
      </span>
      <span className={canRedo ? '' : 'pointer-events-none opacity-30'}>
        <IconButton icon={Redo2} title={t('Redo (Cmd/Ctrl+Shift+Z)')} onClick={redo} />
      </span>
      <span className="ml-1.5 hidden max-w-[160px] truncate text-[11px] text-zinc-300 xl:inline" title={dirty ? t('Unsaved changes (autosaved for recovery)') : t('Saved')}>
        {name}
      </span>
      {dirty && <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gps" title={t('Unsaved changes')} />}
    </div>
  );
}

function LanguageSwitch() {
  const lang = useLang();
  return (
    <div title={t('Language')}>
      <Segmented<Lang>
        mono
        className="w-[72px]"
        value={lang}
        onChange={setLang}
        options={[
          { value: 'en', label: 'EN' },
          { value: 'fr', label: 'FR' },
        ]}
      />
    </div>
  );
}

/** Devices that failed a send or did not answer the last reachability probe. */
function FaultBadge() {
  const devices = useVoxel((s) => s.devices);
  const health = useVoxel((s) => s.health);
  const stats = useVoxel((s) => s.stats.devices);
  const { setView } = useVoxelActions();
  const faulty = devices.filter((d) => (stats[d.id]?.errors ?? 0) > 0 || health[d.id]?.reachable === false);
  if (faulty.length === 0) return null;
  return (
    <button
      type="button"
      onClick={() => setView('devices')}
      title={faulty.map((d) => d.name).join(', ')}
      className="flex h-6 items-center gap-1 rounded-[5px] border border-red-500/40 bg-red-500/10 px-2 font-mono text-[10px] text-red-400"
    >
      {faulty.length === 1 ? t('1 FAULT') : t('{n} FAULTS', { n: faulty.length })}
    </button>
  );
}

export function TopHeader() {
  const view = useVoxel((s) => s.view);
  const stats = useVoxel((s) => s.stats);
  const gpsSensor = useVoxel((s) => s.sensors.find((x) => x.kind === 'gps' && x.enabled) ?? null);
  const gpsValue = useVoxel((s) => (gpsSensor ? (s.sensorValues[`${gpsSensor.id}.speed`] ?? 0) : 0));
  const gps = gpsSensor ? denormalize(sensorChannels(gpsSensor)[0], gpsValue) : 0;
  const ddpOutput = useVoxel((s) => s.ddpOutput);
  const blackout = useVoxel((s) => s.blackout);
  const { setView, toggle, setBlackout, panic } = useVoxelActions();

  return (
    <header className="flex h-10 min-w-0 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <div className="flex items-center gap-2 pr-2">
        <div className="grid h-5 w-5 grid-cols-2 gap-[2px]">
          <span className="rounded-[1px] bg-spatial" />
          <span className="rounded-[1px] bg-zinc-700" />
          <span className="rounded-[1px] bg-zinc-700" />
          <span className="rounded-[1px] bg-audio" />
        </div>
        <span className="hidden whitespace-nowrap font-mono text-[11px] font-semibold tracking-[0.18em] text-zinc-100 min-[1800px]:inline">
          VOXEL <span className="text-zinc-600">//</span> STUDIO
        </span>
      </div>
      <ProjectControls />

      <nav className="flex h-full items-stretch">
        {TABS.map((tab) => {
          const on = view === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setView(tab.id)}
              title={`${t(tab.label)} (${tab.key})`}
              className={`relative flex items-center gap-1.5 whitespace-nowrap px-2.5 text-[11px] font-medium transition-colors 2xl:px-3 ${on ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              <tab.icon size={13} strokeWidth={1.75} className={on ? 'text-spatial' : ''} />
              <span className={on ? '' : 'hidden 2xl:inline'}>{t(tab.label)}</span>
              <span className="font-mono text-[9px] text-zinc-600">{tab.key}</span>
              {on && <span className="absolute inset-x-2 bottom-0 h-px bg-spatial" />}
            </button>
          );
        })}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-3 2xl:gap-4">
        <FaultBadge />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setBlackout(!blackout)}
            title={t('Blackout (B): send black to every LED, streaming continues')}
            className={`flex h-6 items-center gap-1.5 rounded-[5px] border px-2 font-mono text-[10px] tracking-wider transition-colors ${
              blackout ? 'border-red-500 bg-red-500/20 text-red-300' : 'border-line text-zinc-400 hover:border-line-hi'
            }`}
          >
            <Moon size={11} strokeWidth={2} />
            {blackout ? t('BLACKOUT ON') : t('BLACKOUT')}
          </button>
          <button
            type="button"
            onClick={panic}
            title={t('Panic (Esc): blackout, strobe off, scan off, buttons released')}
            className="flex h-6 items-center gap-1 rounded-[5px] border border-red-500/40 px-2 font-mono text-[10px] tracking-wider text-red-400 hover:bg-red-500/10"
          >
            <OctagonX size={11} strokeWidth={2} />
            {t('PANIC')}
          </button>
        </div>
        <button
          type="button"
          onClick={() => toggle('ddpOutput')}
          title={ddpOutput ? t('Streaming DDP: click to release (controllers fall back to their own effects)') : t('Released: click to resume DDP streaming')}
          className={`flex h-6 items-center gap-1.5 rounded-[5px] border px-2 font-mono text-[10px] transition-colors ${
            ddpOutput ? 'border-net/40 bg-net/10 text-net' : 'border-line text-zinc-500'
          }`}
        >
          <Radio size={11} strokeWidth={2} />
          DDP {stats.ddpFps.toFixed(0).padStart(2, '0')} FPS
        </button>
        <div className="hidden items-baseline gap-1 xl:flex">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">{t('Voxels')}</span>
          <span className="tabular font-mono text-[11px] text-spatial">{stats.activeVoxels}</span>
        </div>
        <div className="hidden min-[1800px]:block">
          <AudioMeter />
        </div>
        <div className="hidden items-baseline gap-1 min-[1800px]:flex">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">GPS</span>
          <span className="tabular font-mono text-[11px] text-gps">{gps.toFixed(0).padStart(3, '0')}</span>
          <span className="font-mono text-[10px] text-zinc-500">km/h</span>
        </div>
        <div className="hidden items-baseline gap-1 xl:flex" title={t('Render loop frame rate')}>
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">GL</span>
          <span className="tabular font-mono text-[11px] text-zinc-300">{stats.renderFps.toFixed(0)}</span>
        </div>
        <span
          className={`rounded-[4px] border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
            bridgeMode === 'native' ? 'border-net/40 text-net' : 'border-line text-zinc-500'
          }`}
          title={bridgeMode === 'native' ? t('Tauri: real UDP sockets') : t('Browser: UDP is simulated')}
        >
          {bridgeMode === 'native' ? t('Native UDP') : t('Web Sim')}
        </span>
        <LanguageSwitch />
      </div>
    </header>
  );
}
