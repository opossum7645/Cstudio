/**
 * Runtime configuration, read once from environment variables.
 * Every limit has a hard ceiling so a client can never request more than the operator allows.
 */
export type SandboxDriver = 'native' | 'docker';

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const v = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const config = {
  port: num('CSTUDIO_PORT', 8787),
  host: process.env.CSTUDIO_HOST ?? '0.0.0.0',
  /** Allowed browser origins (comma separated). "*" allows any origin (development only). */
  allowedOrigins: (process.env.CSTUDIO_ORIGINS ?? '*').split(',').map((s) => s.trim()).filter(Boolean),
  sandboxDriver: (process.env.CSTUDIO_SANDBOX === 'docker' ? 'docker' : 'native') as SandboxDriver,
  dockerImage: process.env.CSTUDIO_DOCKER_IMAGE ?? 'cstudio-sandbox:latest',
  /** Root for per-job temporary directories. */
  workRoot: process.env.CSTUDIO_WORK_ROOT ?? '/tmp/cstudio-jobs',
  /** Unprivileged uid/gid used by the native sandbox. */
  sandboxUid: num('CSTUDIO_SANDBOX_UID', 65534),
  sandboxGid: num('CSTUDIO_SANDBOX_GID', 65534),
  limits: {
    maxFiles: 200,
    maxFileBytes: 512 * 1024,
    maxProjectBytes: 4 * 1024 * 1024,
    compileTimeoutMs: num('CSTUDIO_COMPILE_TIMEOUT_MS', 20_000),
    /** CPU seconds a running program may consume. */
    runCpuSeconds: num('CSTUDIO_RUN_CPU_S', 5),
    /** Default and maximum wall-clock time for an interactive run. */
    runWallDefaultMs: num('CSTUDIO_RUN_WALL_MS', 60_000),
    runWallMaxMs: num('CSTUDIO_RUN_WALL_MAX_MS', 300_000),
    memoryBytes: num('CSTUDIO_MEMORY_BYTES', 256 * 1024 * 1024),
    maxProcesses: num('CSTUDIO_MAX_PROCS', 32),
    maxOutputBytes: num('CSTUDIO_MAX_OUTPUT', 1024 * 1024),
    maxWrittenFileBytes: 8 * 1024 * 1024,
    debugSessionMs: num('CSTUDIO_DEBUG_MS', 15 * 60_000),
    concurrentJobs: num('CSTUDIO_CONCURRENT_JOBS', 4),
    requestsPerMinute: num('CSTUDIO_RPM', 120),
  },
} as const;
