/** Compilation state: diagnostics (Problems), compiler log (Output) and the last successful build snapshot. */
import { create } from 'zustand';
import type { BuildConfig, CompileResult, Diagnostic } from '../../types';
import { api, BackendError, SourceFile } from '../../services/api';
import { useApp, activeBuildConfig } from '../../stores/appStore';
import { formatBytes, formatDuration, hashFiles, uid } from '../../utils/misc';
import { useBackend } from '../../services/backendStatus';

export type LogKind = 'info' | 'command' | 'stdout' | 'stderr' | 'success' | 'error' | 'warning';
export interface LogEntry {
  id: string;
  time: number;
  kind: LogKind;
  text: string;
}

export interface BuildSnapshot {
  files: SourceFile[];
  config: BuildConfig;
  hash: string;
  at: number;
}

interface BuildState {
  diagnostics: Diagnostic[];
  log: LogEntry[];
  building: boolean;
  lastResult: CompileResult | null;
  lastBuild: BuildSnapshot | null;
  /** hash of the sources the diagnostics refer to */
  diagnosticsHash: string | null;
}

export const useBuild = create<BuildState>(() => ({ diagnostics: [], log: [], building: false, lastResult: null, lastBuild: null, diagnosticsHash: null }));

export function log(kind: LogKind, text: string): void {
  useBuild.setState((s) => ({ log: [...s.log.slice(-800), { id: uid('l'), time: Date.now(), kind, text }] }));
}

export function clearLog(): void {
  useBuild.setState({ log: [] });
}

const SKIP = /^(build\/|\.cstudio\/)/;
const MAX_BYTES = 3.5 * 1024 * 1024;

/** Current project sources as sent to the compiler (unsaved edits included). */
export function collectSources(): SourceFile[] {
  const { project, buffers } = useApp.getState();
  if (!project) return [];
  const out: SourceFile[] = [];
  let total = 0;
  for (const path of Object.keys(project.files).sort()) {
    if (SKIP.test(path)) continue;
    const content = buffers[path] ?? project.files[path]!;
    total += content.length;
    if (total > MAX_BYTES) break;
    out.push({ path, content });
  }
  return out;
}

export function sourcesHash(files: SourceFile[]): string {
  return hashFiles(Object.fromEntries(files.map((f) => [f.path, f.content])));
}

export function configSummary(c: BuildConfig): string {
  const f = [c.compiler, c.std === 'c23' ? '-std=c2x' : `-std=${c.std}`];
  if (c.warnings.all) f.push('-Wall');
  if (c.warnings.extra) f.push('-Wextra');
  if (c.warnings.pedantic) f.push('-pedantic');
  if (c.warnings.asErrors) f.push('-Werror');
  f.push(`-${c.optimization}`);
  if (c.debugInfo) f.push('-g');
  if (c.mode === 'release') f.push('-DNDEBUG');
  c.defines.forEach((d) => f.push(`-D${d}`));
  if (c.sanitizeUndefined) f.push('-fsanitize=undefined');
  f.push(...c.extraFlags);
  c.libraries.forEach((l) => f.push(`-l${l}`));
  return f.join(' ');
}

/** Records a compile result coming from /api/compile or from a run/debug session. */
export function applyCompileResult(result: CompileResult, files: SourceFile[], config: BuildConfig, label = 'Build'): void {
  for (const st of result.steps) {
    log('command', `$ ${st.command}`);
    if (st.stdout.trim()) log('stdout', st.stdout.trimEnd());
    if (st.stderr.trim()) log('stderr', st.stderr.trimEnd());
  }
  const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = result.diagnostics.filter((d) => d.severity === 'warning').length;
  const summary = `${errors} errori, ${warnings} warning — ${formatDuration(result.durationMs)}`;
  if (result.success) {
    log('success', `${label} riuscita (${summary})${result.binarySize ? ` — eseguibile ${formatBytes(result.binarySize)}` : ''}`);
  } else log('error', `${label} non riuscita (${summary})`);
  const hash = sourcesHash(files);
  useBuild.setState({
    diagnostics: result.diagnostics,
    lastResult: result,
    diagnosticsHash: hash,
    lastBuild: result.success ? { files, config, hash, at: Date.now() } : useBuild.getState().lastBuild,
  });
}

let inflight: Promise<boolean> | null = null;

/** Compile the project. `quiet` = background diagnostics (no panel switch, minimal logging). */
export async function compileProject(opts: { quiet?: boolean } = {}): Promise<boolean> {
  if (inflight) return inflight;
  const files = collectSources();
  const config = activeBuildConfig();
  if (!files.some((f) => f.path.endsWith('.c'))) {
    if (!opts.quiet) log('error', 'Il progetto non contiene file .c da compilare');
    return false;
  }
  if (!useBackend.getState().available) {
    if (!opts.quiet) log('error', `Compilazione non disponibile: ${useBackend.getState().message}`);
    return false;
  }
  if (opts.quiet && useBuild.getState().diagnosticsHash === sourcesHash(files)) return true;
  inflight = (async () => {
    useBuild.setState({ building: true });
    if (!opts.quiet) {
      log('info', `Compilazione (${config.mode === 'debug' ? 'Debug' : 'Release'}) — ${configSummary(config)}`);
      useApp.setState({ panelOpen: true, panelTab: 'output' });
    }
    try {
      const result = await api.compile(files, config);
      if (opts.quiet) {
        useBuild.setState({ diagnostics: result.diagnostics, diagnosticsHash: sourcesHash(files), lastResult: result });
        if (result.success) useBuild.setState({ lastBuild: { files, config, hash: sourcesHash(files), at: Date.now() } });
      } else applyCompileResult(result, files, config);
      if (!opts.quiet && !result.success) useApp.setState({ panelTab: 'problems' });
      return result.success;
    } catch (e) {
      const msg = e instanceof BackendError ? e.message : 'Errore imprevisto durante la compilazione';
      if (!opts.quiet) log('error', msg);
      if (e instanceof BackendError && e.status === 0) void useBackend.getState().refresh();
      return false;
    } finally {
      useBuild.setState({ building: false });
      inflight = null;
    }
  })();
  return inflight;
}
