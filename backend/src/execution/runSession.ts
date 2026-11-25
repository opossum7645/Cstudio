/**
 * Interactive "compile & run" session over a WebSocket.
 *
 * client → server  {type:'start', files, config, args?, wallTimeoutMs?, skipCompile?}
 *                  {type:'stdin', data} | {type:'eof'} | {type:'stop'}
 * server → client  {type:'phase', phase} | {type:'compile', result} | {type:'stdout'|'stderr', data}
 *                  {type:'exit', ...} | {type:'error', message}
 */
import type { WebSocket } from 'ws';
import { config } from '../config.js';
import { compileProject, BINARY_PATH } from '../compiler/compile.js';
import { createJob, Job } from '../security/workspace.js';
import { spawnSandboxed, SandboxHandle } from '../security/sandbox.js';
import { validateBuildConfig, validateFiles, ValidationError } from '../security/validation.js';
import { describeSignal, normaliseExit } from './signals.js';
import { logger } from '../services/logger.js';

type ClientMsg =
  | { type: 'start'; files: unknown; config: unknown; args?: unknown; wallTimeoutMs?: unknown }
  | { type: 'stdin'; data: string }
  | { type: 'eof' }
  | { type: 'stop' };

function send(ws: WebSocket, msg: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function validateArgs(a: unknown): string[] {
  if (a === undefined) return [];
  if (!Array.isArray(a) || a.length > 32 || a.some((x) => typeof x !== 'string' || x.length > 256)) {
    throw new ValidationError('Invalid program arguments');
  }
  return a as string[];
}

export function handleRunSession(ws: WebSocket): void {
  let job: Job | null = null;
  let handle: SandboxHandle | null = null;
  let started = false;
  let stoppedByUser = false;
  let finished = false;

  const cleanup = async () => {
    handle?.kill();
    handle = null;
    await job?.release();
    job = null;
  };

  ws.on('close', () => {
    void cleanup();
  });

  ws.on('message', async (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString()) as ClientMsg;
    } catch {
      return send(ws, { type: 'error', message: 'Malformed message' });
    }
    if (msg.type === 'stdin') {
      if (handle && typeof msg.data === 'string' && msg.data.length <= 64 * 1024) handle.proc.stdin.write(msg.data);
      return;
    }
    if (msg.type === 'eof') {
      handle?.proc.stdin.end();
      return;
    }
    if (msg.type === 'stop') {
      stoppedByUser = true;
      if (handle) handle.kill();
      else {
        finished = true;
        send(ws, { type: 'exit', exitCode: null, signal: null, reason: 'stopped', durationMs: 0, timedOut: false });
        await cleanup();
        ws.close();
      }
      return;
    }
    if (msg.type !== 'start' || started) return;
    started = true;
    try {
      const files = validateFiles(msg.files);
      const cfg = validateBuildConfig(msg.config);
      const args = validateArgs(msg.args);
      const requested = typeof msg.wallTimeoutMs === 'number' ? msg.wallTimeoutMs : config.limits.runWallDefaultMs;
      const wallMs = Math.min(Math.max(1000, requested), config.limits.runWallMaxMs);

      job = await createJob(files);
      send(ws, { type: 'phase', phase: 'compiling' });
      const result = await compileProject(job, files, cfg);
      send(ws, { type: 'compile', result });
      if (!result.success || stoppedByUser) {
        finished = true;
        send(ws, { type: 'exit', exitCode: null, signal: null, reason: stoppedByUser ? 'stopped' : 'compile-failed', durationMs: 0, timedOut: false });
        await cleanup();
        ws.close();
        return;
      }

      send(ws, { type: 'phase', phase: 'running', limits: { wallMs, cpuSeconds: config.limits.runCpuSeconds, memoryBytes: config.limits.memoryBytes } });
      const start = Date.now();
      handle = spawnSandboxed({ jobDir: job.dir, uid: job.uid, kind: 'run', argv: [`./${BINARY_PATH}`, ...args] });
      const h = handle;
      let bytes = 0;
      let truncated = false;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        h.kill();
      }, wallMs);
      const forward = (type: 'stdout' | 'stderr') => (d: Buffer) => {
        if (truncated) return;
        bytes += d.length;
        if (bytes > config.limits.maxOutputBytes) {
          truncated = true;
          send(ws, { type, data: `\n[C-Studio] Output limit (${config.limits.maxOutputBytes} bytes) reached — program stopped.\n` });
          h.kill();
          return;
        }
        send(ws, { type, data: d.toString('utf8') });
      };
      h.proc.stdout.on('data', forward('stdout'));
      h.proc.stderr.on('data', forward('stderr'));
      h.proc.stdin.on('error', () => undefined);
      h.proc.on('error', (e) => send(ws, { type: 'error', message: `Failed to start program: ${e.message}` }));
      h.proc.on('close', async (code, sig) => {
        clearTimeout(timer);
        finished = true;
        const n = normaliseExit(code, sig, config.sandboxDriver === 'docker');
        const reason = timedOut ? 'timeout' : truncated ? 'output-limit' : stoppedByUser ? 'stopped' : n.signal ? 'signal' : 'exited';
        send(ws, {
          type: 'exit',
          exitCode: n.exitCode,
          signal: n.signal,
          signalDescription: describeSignal(n.signal),
          reason,
          durationMs: Date.now() - start,
          timedOut,
          outputTruncated: truncated,
        });
        await cleanup();
        ws.close();
      });
    } catch (e) {
      const err = e as Error;
      if (!(err instanceof ValidationError)) logger.error('run session failed', { err: err.message });
      send(ws, { type: 'error', message: err.message });
      if (!finished) send(ws, { type: 'exit', exitCode: null, signal: null, reason: 'error', durationMs: 0, timedOut: false });
      await cleanup();
      ws.close();
    }
  });
}
