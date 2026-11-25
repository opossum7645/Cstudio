import { spawn, ChildProcess } from 'node:child_process';
import WebSocket from 'ws';

export const PORT = 18787;
export const BASE = `http://127.0.0.1:${PORT}`;

export async function startServer(): Promise<ChildProcess> {
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    env: { ...process.env, CSTUDIO_PORT: String(PORT), CSTUDIO_HOST: '127.0.0.1', CSTUDIO_RUN_WALL_MS: '4000', CSTUDIO_LOG: 'warn', CSTUDIO_RPM: '10000' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return proc;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error('server did not start');
}

export interface Msg {
  type: string;
  [k: string]: unknown;
}

/** Opens a WS session, sends `start`, lets `onMessage` react, resolves with every message received. */
export function session(path: string, start: Record<string, unknown>, onMessage?: (m: Msg, ws: WebSocket) => void, timeoutMs = 20_000): Promise<Msg[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}${path}`);
    const msgs: Msg[] = [];
    const t = setTimeout(() => {
      ws.close();
      reject(new Error('session timeout; got ' + JSON.stringify(msgs.map((m) => m.type))));
    }, timeoutMs);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'start', ...start })));
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as Msg;
      msgs.push(m);
      onMessage?.(m, ws);
    });
    ws.on('close', () => {
      clearTimeout(t);
      resolve(msgs);
    });
    ws.on('error', reject);
  });
}

export const stdout = (msgs: Msg[]) => msgs.filter((m) => m.type === 'stdout').map((m) => m.data).join('');
export const exitMsg = (msgs: Msg[]) => msgs.find((m) => m.type === 'exit') as Msg;
