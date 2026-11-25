/** Detects which compilers/tools are available (on the host or inside the sandbox image). */
import { spawnSync } from 'node:child_process';
import { config } from '../config.js';
import { CompilerId } from '../types.js';

export interface ToolInfo {
  available: boolean;
  version: string;
}

export interface Toolchain {
  gcc: ToolInfo;
  clang: ToolInfo;
  gdb: ToolInfo;
  clangFormat: ToolInfo;
}

let cached: Toolchain | null = null;

function probe(cmd: string): ToolInfo {
  const r =
    config.sandboxDriver === 'docker'
      ? spawnSync('docker', ['run', '--rm', '--network', 'none', config.dockerImage, cmd, '--version'], { encoding: 'utf8', timeout: 20_000 })
      : spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 5_000 });
  if (r.status !== 0) return { available: false, version: '' };
  return { available: true, version: (r.stdout.split('\n')[0] ?? '').trim() };
}

export function getToolchain(): Toolchain {
  if (!cached) {
    cached = { gcc: probe('gcc'), clang: probe('clang'), gdb: probe('gdb'), clangFormat: probe('clang-format') };
  }
  return cached;
}

export function compilerBinary(id: CompilerId): string {
  return id === 'clang' ? 'clang' : 'gcc';
}
