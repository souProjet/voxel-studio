import { useEffect } from 'react';
import { VoxelProvider, useVoxel, useVoxelActions, useVoxelStoreRef } from './state/useVoxelStore';
import { startEngine } from './services/engine';
import { TopHeader, VIEW_ORDER } from './components/ui/TopHeader';
import { StudioView } from './components/viewport/StudioView';
import { CameraScannerView } from './components/scanner/CameraScannerView';
import { ModulationView } from './components/patcher/ModulationView';
import { DeviceFleetView } from './components/devices/DeviceFleetView';
import { LiveControlPad } from './components/livepad/LiveControlPad';

function Shell() {
  const store = useVoxelStoreRef();
  const view = useVoxel((s) => s.view);
  const { setView } = useVoxelActions();

  useEffect(() => startEngine(store), [store]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || e.metaKey || e.ctrlKey) return;
      const i = Number(e.key) - 1;
      if (i >= 0 && i < VIEW_ORDER.length) setView(VIEW_ORDER[i]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setView]);

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
