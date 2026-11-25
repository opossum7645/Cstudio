/**
 * Background persistence: unsaved-change drafts, auto save, session (tabs/layout),
 * background diagnostics after save and the "leave page" guard.
 */
import { useApp, dirtyFiles, saveAll, persistSession } from '../stores/appStore';
import { projectRepo } from '../features/projects/projectRepo';
import { compileProject } from '../features/compiler/buildStore';
import { useBackend } from '../services/backendStatus';
import { debounce } from '../utils/misc';

export function installPersistence(): () => void {
  const saveDrafts = debounce(() => {
    const s = useApp.getState();
    if (!s.project) return;
    const dirty = dirtyFiles(s);
    const id = s.project.id;
    if (dirty.length === 0) void projectRepo.clearDrafts(id).catch(() => undefined);
    else void projectRepo.saveDrafts(id, { buffers: Object.fromEntries(dirty.map((p) => [p, s.buffers[p]!])), savedAt: Date.now() }).catch(() => undefined);
  }, 800);

  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleAutoSave = () => {
    const st = useApp.getState().settings;
    if (st.autoSave !== 'afterDelay') return;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      if (dirtyFiles().length) void saveAll();
    }, Math.max(300, st.autoSaveDelay));
  };

  const saveSession = debounce(() => void persistSession(), 300);
  const liveDiag = debounce(() => {
    const s = useApp.getState();
    if (s.project && s.settings.liveDiagnostics && s.settings.extensions.liveDiagnostics !== false && useBackend.getState().available) void compileProject({ quiet: true });
  }, 700);

  const unsub = useApp.subscribe((s, prev) => {
    if (s.buffers !== prev.buffers && s.project) {
      saveDrafts();
      scheduleAutoSave();
    }
    if (s.project && prev.project && s.project.id === prev.project.id && s.project.files !== prev.project.files) liveDiag();
    if (s.project && (s.groups !== prev.groups || s.layout !== prev.layout || s.expanded !== prev.expanded || s.activeGroup !== prev.activeGroup)) saveSession();
  });

  const onBlur = () => {
    if (useApp.getState().settings.autoSave === 'onFocusChange' && dirtyFiles().length) void saveAll();
  };
  const onUnload = (e: BeforeUnloadEvent) => {
    saveDrafts.flush();
    saveSession.flush();
    if (dirtyFiles().length && useApp.getState().settings.autoSave === 'off') {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  const onHide = () => {
    if (document.visibilityState === 'hidden') {
      saveDrafts.flush();
      saveSession.flush();
    }
  };
  window.addEventListener('blur', onBlur);
  window.addEventListener('beforeunload', onUnload);
  document.addEventListener('visibilitychange', onHide);
  return () => {
    unsub();
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('beforeunload', onUnload);
    document.removeEventListener('visibilitychange', onHide);
  };
}
