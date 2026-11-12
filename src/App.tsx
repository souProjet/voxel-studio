import { useEffect } from 'react';
import { VoxelProvider, useVoxel, useVoxelActions, useVoxelStoreRef } from './state/useVoxelStore';
import { useProjectCommands } from './state/useProjectCommands';
import { startEngine } from './services/engine';
import { startAutosave } from './services/project';
import { TopHeader, VIEW_ORDER } from './components/ui/TopHeader';
import { StudioView } from './components/viewport/StudioView';
import { CameraScannerView } from './components/scanner/CameraScannerView';
import { ModulationView } from './components/patcher/ModulationView';
import { DeviceFleetView } from './components/devices/DeviceFleetView';
import { LiveControlPad } from './components/livepad/LiveControlPad';

function Shell() {
  const store = useVoxelStoreRef();
  const view = useVoxel((s) => s.view);
  const { setView, setBlackout, panic } = useVoxelActions();
  const cmd = useProjectCommands();

  useEffect(() => startEngine(store), [store]);
  useEffect(() => startAutosave(store), [store]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void cmd.save();
        return;
      }
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void cmd.open();
        return;
      }
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || mod) return;
      if (e.key === 'Escape') return panic();
      if (e.key.toLowerCase() === 'b') return setBlackout(!store.getState().blackout);
      const i = Number(e.key) - 1;
      if (i >= 0 && i < VIEW_ORDER.length) setView(VIEW_ORDER[i]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setView, setBlackout, panic, cmd, store]);

  return (
    <div className="flex h-full flex-col bg-canvas">
      <TopHeader />
      {/* The studio stays mounted so the WebGL context and camera survive tab switches. */}
      <div className={view === 'studio' ? 'flex min-h-0 flex-1' : 'hidden'}>
        <StudioView />
      </div>
      {view === 'scanner' && <CameraScannerView />}
      {view === 'patcher' && <ModulationView />}
      {view === 'devices' && <DeviceFleetView />}
      {view === 'livepad' && <LiveControlPad />}
      <NoticeToast />
    </div>
  );
}

function NoticeToast() {
  const notice = useVoxel((s) => s.notice);
  const { dismissNotice } = useVoxelActions();
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(dismissNotice, notice.tone === 'error' ? 8000 : 3500);
    return () => window.clearTimeout(id);
  }, [notice, dismissNotice]);
  if (!notice) return null;
  return (
    <div
      role="status"
      onClick={dismissNotice}
      className={`fixed bottom-10 right-4 z-50 max-w-[420px] cursor-pointer rounded-md border bg-panel px-3 py-2 text-[11px] shadow-lg ${
        notice.tone === 'error' ? 'border-red-500/50 text-red-300' : 'border-line-hi text-zinc-200'
      }`}
    >
      {notice.text}
    </div>
  );
}

export function App() {
  return (
    <VoxelProvider>
      <Shell />
    </VoxelProvider>
  );
}
