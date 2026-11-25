import { constants } from 'node:os';

const DESCRIPTIONS: Record<string, string> = {
  SIGFPE: 'Floating point exception — arithmetic error such as integer division by zero',
  SIGSEGV: 'Segmentation fault — invalid memory access (NULL/dangling pointer, out-of-bounds, stack overflow)',
  SIGABRT: 'Aborted — abort() was called (failed assert, heap corruption detected by libc, …)',
  SIGBUS: 'Bus error — misaligned or invalid memory access',
  SIGILL: 'Illegal instruction',
  SIGXCPU: 'CPU time limit exceeded',
  SIGXFSZ: 'File size limit exceeded',
  SIGKILL: 'Killed (resource limit, timeout or manual stop)',
  SIGTERM: 'Terminated',
  SIGPIPE: 'Broken pipe',
  SIGTRAP: 'Trace/breakpoint trap',
};

export function describeSignal(sig: string | null): string | null {
  if (!sig) return null;
  return DESCRIPTIONS[sig] ?? sig;
}

const byNumber = new Map<number, string>(Object.entries(constants.signals).map(([k, v]) => [v as number, k]));

/**
 * Normalises (exitCode, signal). Shells and container runtimes report a signal-terminated
 * process as exit status 128+N; translate that back when the driver cannot report it directly.
 */
export function normaliseExit(exitCode: number | null, signal: string | null, trust128: boolean): { exitCode: number | null; signal: string | null } {
  if (signal) return { exitCode: null, signal };
  if (trust128 && exitCode !== null && exitCode > 128 && exitCode < 128 + 65) {
    const name = byNumber.get(exitCode - 128);
    if (name) return { exitCode: null, signal: name };
  }
  return { exitCode, signal: null };
}
