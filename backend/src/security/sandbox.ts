/**
 * Process isolation for untrusted work (compiler, user programs, gdb).
 *
 * Two drivers:
 *  - "docker" (recommended for production): every step runs in a throw-away container with
 *    no network, read-only root fs, dropped capabilities, memory/pids/cpu limits.
 *  - "native" (development / single-tenant): Linux namespaces via util-linux. The process gets
 *    its own network (no interfaces), PID, IPC, UTS and mount namespaces; /root, /home, /tmp,
 *    /var, /opt, /srv are hidden behind empty tmpfs mounts; it runs under a dedicated
 *    unprivileged uid with no_new_privs and rlimits (address space, CPU, processes, file size,
 *    open files, no core dumps). Requires root (or CAP_SYS_ADMIN) for the backend process.
 *
 * Wall-clock timeouts are enforced by the caller through SandboxHandle.kill().
 */
import { spawn, ChildProcessWithoutNullStreams, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../services/logger.js';

export type SandboxKind = 'compile' | 'run' | 'debug' | 'tool';

export interface SandboxOptions {
  jobDir: string;
  /** argv executed inside the sandbox with the job directory as cwd. */
  argv: string[];
  kind: SandboxKind;
  /** uid assigned to this job (native driver). */
  uid: number;
  env?: Record<string, string>;
}

export interface SandboxHandle {
  proc: ChildProcessWithoutNullStreams;
  kill(): void;
}

/** Working directory as seen from inside the sandbox. */
export const SANDBOX_WORKDIR = config.sandboxDriver === 'docker' ? '/work' : '/mnt/work';

function limitsFor(kind: SandboxKind) {
  const l = config.limits;
  switch (kind) {
    case 'compile':
    case 'tool':
      return { as: 1024 * 1024 * 1024, cpu: 20, nproc: 64, fsize: 64 * 1024 * 1024 };
    case 'debug':
      return { as: 1024 * 1024 * 1024, cpu: Math.max(l.runCpuSeconds * 4, 30), nproc: l.maxProcesses + 8, fsize: l.maxWrittenFileBytes };
    case 'run':
    default:
      return { as: l.memoryBytes, cpu: l.runCpuSeconds, nproc: l.maxProcesses, fsize: l.maxWrittenFileBytes };
  }
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

const BASE_ENV: Record<string, string> = {
  PATH: '/usr/local/bin:/usr/bin:/bin',
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  HOME: '/tmp',
  TMPDIR: '/tmp',
  TERM: 'dumb',
};

function spawnNative(opts: SandboxOptions): SandboxHandle {
  const lim = limitsFor(opts.kind);
  const env = { ...BASE_ENV, ...opts.env };
  const inner = [
    'setpriv', `--reuid=${opts.uid}`, `--regid=${opts.uid}`, '--clear-groups', '--no-new-privs', '--inh-caps=-all',
    '--',
    'prlimit', `--as=${lim.as}`, `--cpu=${lim.cpu}`, `--nproc=${lim.nproc}`, `--fsize=${lim.fsize}`, '--nofile=128', '--core=0',
    '--',
    'env', '-i', ...Object.entries(env).map(([k, v]) => `${k}=${v}`),
    ...opts.argv,
  ];
  const hide = ['/root', '/home', '/var', '/opt', '/srv', '/media'];
  const script = [
    'set -e',
    `mount -t tmpfs -o size=8m,mode=755 cstudio /mnt`,
    `mkdir -p ${SANDBOX_WORKDIR}`,
    `mount --bind ${shq(opts.jobDir)} ${SANDBOX_WORKDIR}`,
    ...hide.map((d) => `if [ -d ${d} ]; then mount -t tmpfs -o size=1m,mode=755 cstudio ${d}; fi`),
    `mount -t tmpfs -o size=64m,mode=1777 cstudio /tmp`,
    `cd ${SANDBOX_WORKDIR}`,
    `exec ${inner.map(shq).join(' ')}`,
  ].join('\n');
  const proc = spawn(
    'unshare',
    ['--net', '--pid', '--fork', '--ipc', '--uts', '--mount', '--mount-proc', '--kill-child', '--', '/bin/sh', '-c', script],
    { detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: BASE_ENV },
  );
  return {
    proc,
    kill() {
      try {
        if (proc.pid) process.kill(-proc.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    },
  };
}

function spawnDocker(opts: SandboxOptions): SandboxHandle {
  const lim = limitsFor(opts.kind);
  const name = `cstudio-${randomBytes(6).toString('hex')}`;
  const env = { ...BASE_ENV, ...opts.env };
  const args = [
    'run', '--rm', '-i', '--name', name,
    '--network', 'none',
    '--read-only', '--tmpfs', '/tmp:rw,exec,size=64m',
    '--memory', String(Math.max(lim.as, 64 * 1024 * 1024)), '--memory-swap', String(Math.max(lim.as, 64 * 1024 * 1024)),
    '--pids-limit', String(lim.nproc), '--cpus', '1',
    '--ulimit', `cpu=${lim.cpu}:${lim.cpu}`, '--ulimit', `fsize=${lim.fsize}:${lim.fsize}`, '--ulimit', 'core=0:0', '--ulimit', 'nofile=128:128',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--user', `${opts.uid}:${opts.uid}`,
    '-v', `${opts.jobDir}:${SANDBOX_WORKDIR}:rw`, '-w', SANDBOX_WORKDIR,
    ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
  ];
  if (opts.kind === 'debug') {
    // gdb needs ptrace on its own child; nothing else is granted.
    args.push('--cap-add', 'SYS_PTRACE', '--security-opt', 'seccomp=unconfined');
  }
  args.push(config.dockerImage, ...opts.argv);
  const proc = spawn('docker', args, { detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  return {
    proc,
    kill() {
      spawn('docker', ['kill', name], { stdio: 'ignore' }).on('error', () => undefined);
      try {
        if (proc.pid) process.kill(-proc.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    },
  };
}

export function spawnSandboxed(opts: SandboxOptions): SandboxHandle {
  logger.debug('sandbox spawn', { kind: opts.kind, argv: opts.argv.slice(0, 3) });
  return config.sandboxDriver === 'docker' ? spawnDocker(opts) : spawnNative(opts);
}

export interface SandboxRunResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  outputTruncated: boolean;
}

/** Run a non-interactive command to completion with a wall-clock timeout and output cap. */
export function runSandboxed(opts: SandboxOptions & { timeoutMs: number; stdin?: string }): Promise<SandboxRunResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const h = spawnSandboxed(opts);
    let out = '';
    let err = '';
    let truncated = false;
    let timedOut = false;
    const cap = config.limits.maxOutputBytes;
    const timer = setTimeout(() => {
      timedOut = true;
      h.kill();
    }, opts.timeoutMs);
    h.proc.stdout.on('data', (d: Buffer) => {
      if (out.length < cap) out += d.toString('utf8');
      else truncated = true;
    });
    h.proc.stderr.on('data', (d: Buffer) => {
      if (err.length < cap) err += d.toString('utf8');
      else truncated = true;
    });
    h.proc.on('error', (e) => {
      err += `\n[sandbox] ${e.message}`;
    });
    h.proc.stdin.on('error', () => undefined);
    if (opts.stdin !== undefined) h.proc.stdin.end(opts.stdin);
    else h.proc.stdin.end();
    h.proc.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ exitCode: code, signal, stdout: out, stderr: err, durationMs: Date.now() - start, timedOut, outputTruncated: truncated });
    });
  });
}

/** Verifies that the configured driver can actually isolate processes. */
export function checkSandbox(): { ok: boolean; driver: string; detail: string } {
  if (config.sandboxDriver === 'docker') {
    const r = spawnSync('docker', ['image', 'inspect', config.dockerImage], { encoding: 'utf8' });
    return r.status === 0
      ? { ok: true, driver: 'docker', detail: config.dockerImage }
      : { ok: false, driver: 'docker', detail: `Docker image ${config.dockerImage} not available: ${(r.stderr || String(r.error ?? '')).trim()}` };
  }
  const r = spawnSync('unshare', ['--net', '--pid', '--fork', '--mount', '--', 'true'], { encoding: 'utf8' });
  return r.status === 0
    ? { ok: true, driver: 'native', detail: 'Linux namespaces + setpriv + prlimit' }
    : { ok: false, driver: 'native', detail: `Namespaces unavailable (run the backend as root or use CSTUDIO_SANDBOX=docker): ${r.stderr.trim()}` };
}
