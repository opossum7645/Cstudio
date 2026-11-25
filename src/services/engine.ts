/**
 * Chooses where C code is compiled and run:
 *  - "server": C-Studio backend (GCC/Clang in sandbox, GDB debugger, clang-format)
 *  - "browser": Clang compiled to WebAssembly, running locally (works on static hosting and offline)
 * Setting `compilerEngine`: auto (server when reachable, otherwise browser) | server | browser.
 */
import type { BuildConfig, CompileResult } from '../types';
import { useApp } from '../stores/appStore';
import { useBackend } from './backendStatus';
import { api, SourceFile } from './api';
import { browserEngineSupported, compileInBrowser } from '../features/wasm/browserEngine';

export type Engine = 'server' | 'browser';

export function currentEngine(): Engine | null {
  const pref = useApp.getState().settings.compilerEngine;
  const server = useBackend.getState().available;
  if (pref === 'server') return server ? 'server' : null;
  if (pref === 'browser') return browserEngineSupported ? 'browser' : null;
  return server ? 'server' : browserEngineSupported ? 'browser' : null;
}

/** null when compiling/running is possible, otherwise the reason. */
export function compilerUnavailableReason(): string | null {
  if (currentEngine()) return null;
  const pref = useApp.getState().settings.compilerEngine;
  if (pref === 'server') return useBackend.getState().message;
  return 'Questo browser non supporta WebAssembly/Web Worker e il server di compilazione non è raggiungibile';
}

export function engineLabel(e: Engine | null = currentEngine()): string {
  return e === 'server' ? 'Server (GCC/Clang in sandbox)' : e === 'browser' ? 'Nel browser (Clang WebAssembly)' : 'Non disponibile';
}

export async function compileFiles(files: SourceFile[], config: BuildConfig): Promise<CompileResult> {
  if (currentEngine() === 'browser') return (await compileInBrowser(files, config)).result;
  return api.compile(files, config);
}
