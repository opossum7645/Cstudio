/** Types shared by the HTTP and WebSocket APIs. Mirrored in the frontend (src/types/api.ts). */

export type CompilerId = 'gcc' | 'clang';
export type CStandard = 'c89' | 'c99' | 'c11' | 'c17' | 'c23' | 'gnu11' | 'gnu17';
export type OptLevel = 'O0' | 'O1' | 'O2' | 'O3' | 'Os' | 'Og';

export interface BuildConfig {
  compiler: CompilerId;
  std: CStandard;
  optimization: OptLevel;
  mode: 'debug' | 'release';
  warnings: { all: boolean; extra: boolean; pedantic: boolean; asErrors: boolean };
  debugInfo: boolean;
  defines: string[];
  libraries: string[];
  extraFlags: string[];
  sanitizeUndefined: boolean;
}

export interface ProjectFile {
  path: string;
  content: string;
}

export type Severity = 'error' | 'warning' | 'note' | 'info';

export interface Diagnostic {
  file: string | null;
  line: number;
  column: number;
  severity: Severity;
  message: string;
  source: 'compiler' | 'linker';
}

export interface StepLog {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface CompileResult {
  success: boolean;
  diagnostics: Diagnostic[];
  steps: StepLog[];
  durationMs: number;
  compilerVersion: string;
  /** Present only when the build succeeded. */
  binarySize?: number;
}

export const defaultBuildConfig: BuildConfig = {
  compiler: 'gcc',
  std: 'c17',
  optimization: 'O0',
  mode: 'debug',
  warnings: { all: true, extra: true, pedantic: false, asErrors: false },
  debugInfo: true,
  defines: [],
  libraries: [],
  extraFlags: [],
  sanitizeUndefined: false,
};
