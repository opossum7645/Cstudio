/**
 * Real source-level debugging through GDB/MI, running inside the sandbox.
 *
 * The debuggee's stdin/stdout are attached to two FIFOs in the job directory, so program I/O
 * never mixes with the MI protocol stream and the user can type input while debugging.
 *
 * client → server
 *   {type:'start', files, config, breakpoints:[{file,line}], watches:[expr]}
 *   {type:'command', command:'continue'|'next'|'step'|'finish'|'pause'|'stop'}
 *   {type:'setBreakpoints', file, lines:[n]}
 *   {type:'setWatches', expressions:[expr]}
 *   {type:'evaluate', id, expression}
 *   {type:'selectFrame', level}
 *   {type:'registers'}
 *   {type:'stdin', data}
 * server → client
 *   {type:'phase'|'compile'|'state'|'stdout'|'console'|'evaluate'|'registers'|'breakpoints'|'exit'|'error', ...}
 */
import type { WebSocket } from 'ws';
import { openSync, constants as fsc, closeSync } from 'node:fs';
import { chown } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { Socket } from 'node:net';
import { join } from 'node:path';
import { config } from '../config.js';
import { compileProject, BINARY_PATH } from '../compiler/compile.js';
import { createJob, Job } from '../security/workspace.js';
import { spawnSandboxed, SandboxHandle, SANDBOX_WORKDIR } from '../security/sandbox.js';
import { validateBuildConfig, validateFiles, validatePath, ValidationError } from '../security/validation.js';
import { describeSignal } from '../execution/signals.js';
import { getToolchain } from '../services/toolchain.js';
import { logger } from '../services/logger.js';
import { MIRecord, MIValue, parseMILine, str, list, tuple } from './mi.js';

interface Frame {
  level: number;
  func: string;
  file: string | null;
  line: number;
  addr: string;
}
interface Variable {
  name: string;
  type: string;
  value: string;
  arg: boolean;
}

const ALLOWED_COMMANDS = new Set(['continue', 'next', 'step', 'finish', 'pause', 'stop']);
const EXPR_RE = /^[\w\s\[\]().*&+\-/%<>=!|^~,?:'"\\]{1,200}$/;

function send(ws: WebSocket, msg: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function miQuote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function handleDebugSession(ws: WebSocket): void {
  let job: Job | null = null;
  let gdb: SandboxHandle | null = null;
  let stdinSock: Socket | null = null;
  let stdoutSock: Socket | null = null;
  const fds: number[] = [];
  let started = false;
  let ended = false;
  let token = 1;
  const pending = new Map<number, (r: MIRecord) => void>();
  const breakpoints = new Map<string, { number: string; file: string; line: number; requested: number }>();
  let watches: string[] = [];
  let state: 'starting' | 'running' | 'stopped' | 'exited' = 'starting';
  let sessionTimer: NodeJS.Timeout | null = null;
  let selectedFrame = 0;
  let consoleBuf = '';

  const end = async (exit?: Record<string, unknown>) => {
    if (ended) return;
    ended = true;
    state = 'exited';
    if (exit) send(ws, { type: 'exit', ...exit });
    if (sessionTimer) clearTimeout(sessionTimer);
    for (const [, resolve] of pending) resolve({ kind: 'result', token: null, cls: 'error', data: { msg: 'session ended' } });
    pending.clear();
    gdb?.kill();
    gdb = null;
    stdinSock?.destroy();
    stdoutSock?.destroy();
    for (const fd of fds.splice(0)) {
      try {
        closeSync(fd);
      } catch {
        /* closed by socket */
      }
    }
    await job?.release();
    job = null;
    if (ws.readyState === ws.OPEN) ws.close();
  };

  const mi = (command: string): Promise<MIRecord> =>
    new Promise((resolve) => {
      if (!gdb || ended) return resolve({ kind: 'result', token: null, cls: 'error', data: { msg: 'debugger not running' } });
      const t = token++;
      pending.set(t, resolve);
      gdb.proc.stdin.write(`${t}${command}\n`);
    });

  const relFile = (v: Record<string, MIValue>): string | null => {
    const full = str(v.fullname);
    if (full.startsWith(SANDBOX_WORKDIR + '/')) return full.slice(SANDBOX_WORKDIR.length + 1);
    const f = str(v.file);
    if (!f || f.startsWith('/') || f.startsWith('build/')) return null;
    return f.replace(/^\.\//, '');
  };

  const evaluate = async (expr: string): Promise<{ value?: string; error?: string }> => {
    if (!EXPR_RE.test(expr)) return { error: 'Expression contains unsupported characters' };
    const r = await mi(`-data-evaluate-expression ${miQuote(expr)}`);
    if (r.kind === 'result' && r.cls === 'done') return { value: str(r.data.value) };
    return { error: r.kind === 'result' ? str(r.data.msg) : 'evaluation failed' };
  };

  const publishStopped = async (reason: string, extra: Record<string, unknown>) => {
    const fr = await mi('-stack-list-frames 0 64');
    const frames: Frame[] =
      fr.kind === 'result' && fr.cls === 'done'
        ? list(fr.data.stack).map((x) => {
            const f = tuple(tuple(x).frame);
            return { level: Number(str(f.level)), func: str(f.func) || '??', file: relFile(f), line: Number(str(f.line)) || 0, addr: str(f.addr) };
          })
        : [];
    if (selectedFrame >= frames.length) selectedFrame = 0;
    await mi(`-stack-select-frame ${selectedFrame}`);
    const vr = await mi('-stack-list-variables --simple-values');
    const variables: Variable[] =
      vr.kind === 'result' && vr.cls === 'done'
        ? list(vr.data.variables).map((x) => {
            const v = tuple(x);
            return { name: str(v.name), type: str(v.type), value: v.value !== undefined ? str(v.value) : '{…}', arg: str(v.arg) === '1' };
          })
        : [];
    // expand aggregates (structs/arrays) once so the panel shows their content
    for (const v of variables) {
      if (v.value === '{…}') {
        const e = await evaluate(v.name);
        if (e.value !== undefined) v.value = e.value;
      }
    }
    const watchValues = [];
    for (const w of watches) watchValues.push({ expression: w, ...(await evaluate(w)) });
    const top = frames.find((f) => f.file) ?? frames[0];
    send(ws, {
      type: 'state',
      state: 'stopped',
      reason,
      ...extra,
      location: top ? { file: top.file, line: top.line, func: top.func } : null,
      frames,
      selectedFrame,
      variables,
      watches: watchValues,
    });
  };

  const onRecord = async (rec: MIRecord) => {
    if (rec.kind === 'result') {
      if (rec.token !== null && pending.has(rec.token)) {
        const cb = pending.get(rec.token)!;
        pending.delete(rec.token);
        cb(rec);
      }
      return;
    }
    if (rec.kind === 'console') {
      consoleBuf += rec.text;
      return;
    }
    if (rec.kind === 'target') {
      send(ws, { type: 'stdout', data: rec.text });
      return;
    }
    if (rec.kind === 'exec') {
      if (rec.cls === 'running') {
        state = 'running';
        send(ws, { type: 'state', state: 'running' });
        return;
      }
      if (rec.cls === 'stopped') {
        const reason = str(rec.data.reason);
        if (reason.startsWith('exited')) {
          // give the stdout FIFO a moment to drain before reporting exit
          await new Promise((r) => setTimeout(r, 60));
          const code = reason === 'exited-normally' ? 0 : reason === 'exited' ? parseInt(str(rec.data['exit-code']), 8) : null;
          const sig = reason === 'exited-signalled' ? str(rec.data['signal-name']) : null;
          await end({ exitCode: code, signal: sig, signalDescription: describeSignal(sig), reason: sig ? 'signal' : 'exited' });
          return;
        }
        state = 'stopped';
        selectedFrame = 0;
        const extra: Record<string, unknown> = {};
        if (reason === 'signal-received') {
          const sig = str(rec.data['signal-name']);
          extra.signal = sig;
          extra.signalDescription = describeSignal(sig) ?? str(rec.data['signal-meaning']);
        }
        if (reason === 'breakpoint-hit') extra.breakpoint = str(rec.data.bkptno);
        if (consoleBuf) {
          send(ws, { type: 'console', data: consoleBuf });
          consoleBuf = '';
        }
        await publishStopped(reason || 'paused', extra);
      }
    }
  };

  const insertBreakpoint = async (file: string, line: number) => {
    const r = await mi(`-break-insert -f ${miQuote(`${file}:${line}`)}`);
    if (r.kind === 'result' && r.cls === 'done') {
      const b = tuple(r.data.bkpt);
      const actual = Number(str(b.line)) || line;
      breakpoints.set(`${file}:${line}`, { number: str(b.number), file, line: actual, requested: line });
    }
  };

  const publishBreakpoints = () =>
    send(ws, { type: 'breakpoints', breakpoints: [...breakpoints.values()].map((b) => ({ file: b.file, line: b.line, requested: b.requested, id: b.number })) });

  ws.on('close', () => {
    void end();
  });

  ws.on('message', async (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return send(ws, { type: 'error', message: 'Malformed message' });
    }
    try {
      switch (msg.type) {
        case 'start': {
          if (started) return;
          started = true;
          if (!getToolchain().gdb.available) throw new ValidationError('GDB is not installed on the server');
          const files = validateFiles(msg.files);
          const cfg = validateBuildConfig(msg.config);
          cfg.debugInfo = true;
          if (cfg.optimization !== 'Og') cfg.optimization = 'O0';
          watches = Array.isArray(msg.watches) ? (msg.watches as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 30) : [];
          job = await createJob(files);
          send(ws, { type: 'phase', phase: 'compiling' });
          const result = await compileProject(job, files, cfg);
          send(ws, { type: 'compile', result });
          if (!result.success) return end({ exitCode: null, signal: null, reason: 'compile-failed' });

          // FIFOs for the debuggee's I/O
          const inPath = join(job.dir, 'build', 'stdin.fifo');
          const outPath = join(job.dir, 'build', 'stdout.fifo');
          const mk = spawnSync('mkfifo', ['-m', '600', inPath, outPath]);
          if (mk.status !== 0) throw new Error('Could not create I/O pipes for the debugger');
          if (process.getuid?.() === 0) {
            await chown(inPath, job.uid, job.uid);
            await chown(outPath, job.uid, job.uid);
          }
          const inFd = openSync(inPath, fsc.O_RDWR | fsc.O_NONBLOCK);
          const outFd = openSync(outPath, fsc.O_RDWR | fsc.O_NONBLOCK);
          fds.push(inFd, outFd);
          stdinSock = new Socket({ fd: inFd, readable: false, writable: true });
          stdoutSock = new Socket({ fd: outFd, readable: true, writable: false });
          stdinSock.on('error', () => undefined);
          stdoutSock.on('error', () => undefined);
          let outBytes = 0;
          stdoutSock.on('data', (d: Buffer) => {
            outBytes += d.length;
            if (outBytes <= config.limits.maxOutputBytes) send(ws, { type: 'stdout', data: d.toString('utf8') });
          });

          send(ws, { type: 'phase', phase: 'starting-debugger' });
          gdb = spawnSandboxed({ jobDir: job.dir, uid: job.uid, kind: 'debug', argv: ['gdb', '--interpreter=mi3', '--nx', '-q', BINARY_PATH] });
          let lineBuf = '';
          gdb.proc.stdout.on('data', (d: Buffer) => {
            lineBuf += d.toString('utf8');
            let nl: number;
            while ((nl = lineBuf.indexOf('\n')) >= 0) {
              const line = lineBuf.slice(0, nl).replace(/\r$/, '');
              lineBuf = lineBuf.slice(nl + 1);
              void onRecord(parseMILine(line));
            }
          });
          gdb.proc.stderr.on('data', (d: Buffer) => send(ws, { type: 'console', data: d.toString('utf8') }));
          gdb.proc.on('close', () => {
            void end({ exitCode: null, signal: null, reason: state === 'exited' ? 'exited' : 'debugger-exited' });
          });
          sessionTimer = setTimeout(() => {
            send(ws, { type: 'error', message: `Debug session limit (${config.limits.debugSessionMs / 60000} min) reached` });
            void end({ exitCode: null, signal: null, reason: 'timeout', timedOut: true });
          }, config.limits.debugSessionMs);

          await mi('-gdb-set mi-async on');
          await mi('-gdb-set print pretty off');
          await mi('-gdb-set disassembly-flavor intel');
          const progArgs = Array.isArray(msg.args) ? (msg.args as unknown[]).filter((a): a is string => typeof a === 'string').slice(0, 32) : [];
          if (progArgs.some((a) => !/^[A-Za-z0-9_.,=+\-:%@]{1,128}$/.test(a))) {
            throw new ValidationError('In debug gli argomenti del programma possono contenere solo lettere, cifre e . , = + - : % @');
          }
          await mi(`-exec-arguments ${progArgs.join(' ')} < build/stdin.fifo > build/stdout.fifo 2>&1`);
          const bps = Array.isArray(msg.breakpoints) ? (msg.breakpoints as unknown[]) : [];
          for (const b of bps.slice(0, 100)) {
            const rec = b as { file?: unknown; line?: unknown };
            if (typeof rec.line !== 'number') continue;
            await insertBreakpoint(validatePath(rec.file), Math.floor(rec.line));
          }
          publishBreakpoints();
          send(ws, { type: 'phase', phase: 'running' });
          const run = await mi('-exec-run');
          if (run.kind === 'result' && run.cls === 'error') throw new Error(`GDB: ${str(run.data.msg)}`);
          return;
        }
        case 'command': {
          const cmd = String(msg.command);
          if (!ALLOWED_COMMANDS.has(cmd)) throw new ValidationError('Unknown debugger command');
          if (cmd === 'stop') return end({ exitCode: null, signal: null, reason: 'stopped' });
          if (cmd === 'pause') {
            if (state === 'running') await mi('-exec-interrupt');
            return;
          }
          if (state !== 'stopped') return send(ws, { type: 'error', message: 'The program is not paused' });
          const mapped = { continue: '-exec-continue', next: '-exec-next', step: '-exec-step', finish: '-exec-finish' }[cmd as 'continue'];
          if (selectedFrame !== 0) await mi('-stack-select-frame 0');
          const r = await mi(mapped);
          if (r.kind === 'result' && r.cls === 'error') send(ws, { type: 'error', message: str(r.data.msg) });
          return;
        }
        case 'setBreakpoints': {
          const file = validatePath(msg.file);
          const lines = Array.isArray(msg.lines) ? (msg.lines as unknown[]).filter((n): n is number => typeof n === 'number').map(Math.floor) : [];
          for (const [key, b] of [...breakpoints]) {
            if (b.file === file && !lines.includes(b.requested)) {
              await mi(`-break-delete ${b.number}`);
              breakpoints.delete(key);
            }
          }
          for (const l of lines) if (!breakpoints.has(`${file}:${l}`)) await insertBreakpoint(file, l);
          publishBreakpoints();
          return;
        }
        case 'setWatches': {
          watches = Array.isArray(msg.expressions) ? (msg.expressions as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 30) : [];
          if (state === 'stopped') {
            const values = [];
            for (const w of watches) values.push({ expression: w, ...(await evaluate(w)) });
            send(ws, { type: 'watches', watches: values });
          }
          return;
        }
        case 'evaluate': {
          if (state !== 'stopped') return send(ws, { type: 'evaluate', id: msg.id, error: 'Pause the program to evaluate expressions' });
          return send(ws, { type: 'evaluate', id: msg.id, expression: msg.expression, ...(await evaluate(String(msg.expression ?? ''))) });
        }
        case 'selectFrame': {
          if (state !== 'stopped') return;
          selectedFrame = Math.max(0, Math.floor(Number(msg.level) || 0));
          await publishStopped('frame-selected', {});
          return;
        }
        case 'registers': {
          if (state !== 'stopped') return send(ws, { type: 'registers', registers: [], error: 'Pause the program first' });
          const names = await mi('-data-list-register-names');
          const vals = await mi('-data-list-register-values --skip-unavailable x');
          if (names.kind !== 'result' || vals.kind !== 'result' || vals.cls !== 'done') {
            return send(ws, { type: 'registers', registers: [], error: 'Registers not available' });
          }
          const n = list(names.data['register-names']).map((x) => str(x));
          const regs = list(vals.data['register-values'])
            .map((x) => tuple(x))
            .map((x) => ({ name: n[Number(str(x.number))] ?? str(x.number), value: str(x.value) }))
            .filter((r) => r.name && /^(r[a-z0-9]+|e[a-z]+|[re]ip|eflags|[cdefgs]s)$/.test(r.name));
          return send(ws, { type: 'registers', registers: regs });
        }
        case 'stdin': {
          if (typeof msg.data === 'string' && msg.data.length < 64 * 1024) stdinSock?.write(msg.data);
          return;
        }
        default:
          return;
      }
    } catch (e) {
      const err = e as Error;
      if (!(err instanceof ValidationError)) logger.error('debug session error', { err: err.message });
      send(ws, { type: 'error', message: err.message });
      if (msg.type === 'start') await end({ exitCode: null, signal: null, reason: 'error' });
    }
  });
}
