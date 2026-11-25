/** REST endpoints: health, compile (no run), format. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from '../config.js';
import { compileProject } from '../compiler/compile.js';
import { createJob, activeJobs, BusyError } from '../security/workspace.js';
import { runSandboxed, checkSandbox } from '../security/sandbox.js';
import { validateBuildConfig, validateFiles, ValidationError } from '../security/validation.js';
import { getToolchain } from '../services/toolchain.js';
import { logger } from '../services/logger.js';

export function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

async function readBody(req: IncomingMessage, max = config.limits.maxProjectBytes * 2): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > max) throw new ValidationError('Request body too large');
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new ValidationError('Invalid JSON body');
  }
}

let sandboxStatus: ReturnType<typeof checkSandbox> | null = null;

export function health() {
  sandboxStatus ??= checkSandbox();
  const tc = getToolchain();
  return {
    ok: sandboxStatus.ok && (tc.gcc.available || tc.clang.available),
    version: '1.0.0',
    sandbox: sandboxStatus,
    toolchain: tc,
    limits: {
      runCpuSeconds: config.limits.runCpuSeconds,
      runWallDefaultMs: config.limits.runWallDefaultMs,
      runWallMaxMs: config.limits.runWallMaxMs,
      memoryBytes: config.limits.memoryBytes,
      maxOutputBytes: config.limits.maxOutputBytes,
      compileTimeoutMs: config.limits.compileTimeoutMs,
    },
    activeJobs: activeJobs(),
    features: { compile: true, run: true, debug: tc.gdb.available, format: tc.clangFormat.available },
  };
}

const FORMAT_BASES = new Set(['LLVM', 'Google', 'Chromium', 'Mozilla', 'WebKit', 'GNU', 'Microsoft']);

export async function handleApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  try {
    if (req.method === 'GET' && path === '/api/health') return json(res, 200, health());

    if (req.method === 'POST' && path === '/api/compile') {
      const body = (await readBody(req)) as Record<string, unknown>;
      const files = validateFiles(body.files);
      const cfg = validateBuildConfig(body.config);
      const job = await createJob(files);
      try {
        return json(res, 200, await compileProject(job, files, cfg));
      } finally {
        await job.release();
      }
    }

    if (req.method === 'POST' && path === '/api/format') {
      const body = (await readBody(req, 1024 * 1024)) as Record<string, unknown>;
      if (typeof body.code !== 'string') throw new ValidationError('"code" must be a string');
      if (!getToolchain().clangFormat.available) return json(res, 501, { error: 'clang-format is not installed on the server' });
      const opts = (body.options ?? {}) as Record<string, unknown>;
      const base = typeof opts.base === 'string' && FORMAT_BASES.has(opts.base) ? opts.base : 'LLVM';
      const indent = Math.min(8, Math.max(1, Number(opts.indentWidth) || 4));
      const useTab = opts.useTabs === true ? 'Always' : 'Never';
      const column = Math.min(200, Math.max(0, Number(opts.columnLimit ?? 100) || 0));
      const style = `{BasedOnStyle: ${base}, IndentWidth: ${indent}, TabWidth: ${indent}, UseTab: ${useTab}, ColumnLimit: ${column}}`;
      const job = await createJob([]);
      try {
        const r = await runSandboxed({
          jobDir: job.dir, uid: job.uid, kind: 'tool', timeoutMs: 10_000, stdin: body.code,
          argv: ['clang-format', `--style=${style}`, '--assume-filename=main.c'],
        });
        if (r.exitCode !== 0) return json(res, 422, { error: r.stderr.trim() || 'clang-format failed' });
        return json(res, 200, { code: r.stdout, style });
      } finally {
        await job.release();
      }
    }

    return json(res, 404, { error: 'Not found' });
  } catch (e) {
    if (e instanceof ValidationError) return json(res, 400, { error: e.message });
    if (e instanceof BusyError) return json(res, 503, { error: e.message });
    logger.error('api error', { path, err: (e as Error).message });
    return json(res, 500, { error: 'Internal server error' });
  }
}
