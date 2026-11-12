import { t } from '../../i18n';
import { useVoxel } from '../../state/useVoxelStore';
import { InspectorSidebar } from './InspectorSidebar';
import { SceneTreeSidebar } from './SceneTreeSidebar';
import { ThreeVoxelCanvas } from './ThreeVoxelCanvas';
import { ShaderEditor } from './ShaderEditor';

function StatusBar() {
  const origin = useVoxel((s) => s.params.origin);
  const stats = useVoxel((s) => s.stats);
  const item = (label: string, value: string, color = 'text-zinc-300') => (
    <span className="flex items-baseline gap-1">
      <span className="text-zinc-600">{label}</span>
      <span className={`tabular ${color}`}>{value}</span>
    </span>
  );
  return (
    <div className="flex h-7 shrink-0 items-center gap-4 overflow-hidden whitespace-nowrap border-t border-line bg-panel px-3 font-mono text-[10px]">
      <span className="flex items-baseline gap-1.5">
        <span className="text-zinc-600">{t('ORIGIN')}</span>
        <span className="text-ax-x">{origin[0].toFixed(2)}</span>
        <span className="text-ax-y">{origin[1].toFixed(2)}</span>
        <span className="text-ax-z">{origin[2].toFixed(2)}</span>
      </span>
      {item('R', `${stats.effectiveRadius.toFixed(2)} m`, 'text-spatial')}
      {item('VOXELS', String(stats.activeVoxels), 'text-spatial')}
      <span className="ml-auto" />
      {stats.strobeActive && <span className="text-net">{t('STROBE')}</span>}
      {item(t('POWER'), `${stats.totalWatts.toFixed(1)} W`, 'text-gps')}
      {item('12V', `${stats.totalAmps12.toFixed(2)} A`, 'text-gps')}
      {item('5V', `${stats.totalAmps5.toFixed(2)} A`, 'text-net')}
    </div>
  );
}

export function StudioView() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <SceneTreeSidebar />
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <ThreeVoxelCanvas />
        <ShaderEditor />
        <StatusBar />
      </main>
      <InspectorSidebar />
    </div>
  );
}
