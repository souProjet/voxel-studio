import { useMemo } from 'react';
import { useVoxelActions, useVoxelStoreRef } from './useVoxelStore';
import { parseProject, PROJECT_EXTENSION, serializeProject } from '../services/project';
import { confirmDialog, forgetProjectFile, openProjectFile, saveProjectFile } from '../services/tauriBridge';
import { t } from '../i18n';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const projectNameFromFile = (file: string) => file.replace(/\.voxel\.json$/i, '').replace(/\.json$/i, '');
const fileNameFor = (name: string) =>
  `${
    name
      .trim()
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  }.${PROJECT_EXTENSION}`;

/** New / Open / Save, shared by the header buttons and the keyboard shortcuts. */
export function useProjectCommands() {
  const store = useVoxelStoreRef();
  const actions = useVoxelActions();

  return useMemo(() => {
    const confirmDiscard = async () => !store.getState().dirty || confirmDialog(t('Discard unsaved changes to the current project?'));

    return {
      async save() {
        const s = store.getState();
        try {
          const saved = await saveProjectFile(serializeProject(s), fileNameFor(s.projectName));
          if (!saved) return;
          actions.markSaved(projectNameFromFile(saved.name), saved.path);
          actions.notify(t('Saved {name}', { name: saved.name }));
        } catch (e) {
          actions.notify(t('Save failed: {error}', { error: message(e) }), 'error');
        }
      },
      async open() {
        if (!(await confirmDiscard())) return;
        try {
          const file = await openProjectFile();
          if (!file) return;
          actions.loadProject(parseProject(file.contents), projectNameFromFile(file.name), file.path);
          actions.notify(t('Opened {name}', { name: file.name }));
        } catch (e) {
          // The rejected file must not become the Cmd+S target.
          await forgetProjectFile().catch(() => undefined);
          actions.notify(t('Open failed: {error}', { error: message(e) }), 'error');
        }
      },
      async newProject() {
        if (!(await confirmDiscard())) return;
        await forgetProjectFile();
        actions.newProject();
        actions.notify(t('New project from the default living-room template'));
      },
    };
  }, [store, actions]);
}
