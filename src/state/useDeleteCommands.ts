import { useMemo } from 'react';
import { useVoxelActions, useVoxelStoreRef } from './useVoxelStore';
import { confirmDialog } from '../services/tauriBridge';
import { sensorIdOf } from '../services/sensors';
import { t } from '../i18n';

/**
 * Deletions shared by every panel. Plain deletes rely on undo (and say so); deletes that also
 * remove routes ask first, since the cascade is easy to miss.
 */
export function useDeleteCommands() {
  const store = useVoxelStoreRef();
  const actions = useVoxelActions();

  return useMemo(() => {
    const routesFed = (ownerId: string) => store.getState().routes.filter((r) => sensorIdOf(r.source) === ownerId).length;
    const confirmCascade = async (name: string, ownerId: string) => {
      const n = routesFed(ownerId);
      if (n === 0) return true;
      return confirmDialog(n === 1 ? t('Delete "{name}" and the route it feeds?', { name }) : t('Delete "{name}" and the {n} routes it feeds?', { name, n }));
    };
    const deleted = (name: string) => actions.notify(t('Deleted "{name}". Cmd/Ctrl+Z to undo.', { name }));

    return {
      strip(id: string) {
        const s = store.getState().strips.find((x) => x.id === id);
        if (!s) return;
        actions.removeStrip(id);
        deleted(s.name);
      },
      async sensor(id: string) {
        const s = store.getState().sensors.find((x) => x.id === id);
        if (!s || !(await confirmCascade(s.name, id))) return;
        actions.removeSensor(id);
        deleted(s.name);
      },
      async generator(id: string) {
        const g = store.getState().generators.find((x) => x.id === id);
        if (!g || !(await confirmCascade(g.name, id))) return;
        actions.removeGenerator(id);
        deleted(g.name);
      },
      device(id: string) {
        const d = store.getState().devices.find((x) => x.id === id);
        if (!d) return;
        if (!actions.removeDevice(id)) {
          actions.notify(t('{name} still drives LED segments: move or delete them first.', { name: d.name }), 'error');
          return;
        }
        deleted(d.name);
      },
    };
  }, [store, actions]);
}
