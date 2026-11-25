/**
 * Client for the C-Studio backend (compiler service).
 * Base URL: settings.backendUrl, or the same origin when empty (Vite proxies /api and /ws in dev).
 */
import type { BuildConfig, CompileResult, HealthInfo } from '../types';

export interface SourceFile {
  path: string;
  content: string;
}

let baseUrl = '';
export function setBackendUrl(url: string): void {
  baseUrl = url.trim().replace(/\/+$/, '');
}

export function httpUrl(path: string): string {
  return (baseUrl || '') + path;
}

export function wsUrl(path: string): string {
  if (baseUrl) return baseUrl.replace(/^http/, 'ws') + path;
  const loc = window.location;
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}${path}`;
}

export class BackendError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
    this.name = 'BackendError';
  }
}

async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 60_000);
  try {
    const res = await fetch(httpUrl(path), { ...init, signal: ctrl.signal, headers: { 'Content-Type': 'application/json', ...init.headers } });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new BackendError(`Risposta non valida dal server (${res.status})`, res.status);
    }
    if (!res.ok) throw new BackendError((body as { error?: string }).error ?? `Errore server ${res.status}`, res.status);
    return body as T;
  } catch (e) {
    if (e instanceof BackendError) throw e;
    if ((e as Error).name === 'AbortError') throw new BackendError('Timeout: il server di compilazione non ha risposto');
    throw new BackendError('Server di compilazione non raggiungibile');
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  health: () => request<HealthInfo>('/api/health', { timeoutMs: 8000 }),
  compile: (files: SourceFile[], config: BuildConfig) =>
    request<CompileResult>('/api/compile', { method: 'POST', body: JSON.stringify({ files, config }), timeoutMs: 120_000 }),
  format: (code: string, options: { base: string; indentWidth: number; useTabs: boolean; columnLimit?: number }) =>
    request<{ code: string }>('/api/format', { method: 'POST', body: JSON.stringify({ code, options }), timeoutMs: 15_000 }),
};

/** A JSON-message WebSocket session (run or debug). */
export class Session<In extends { type: string }> {
  private ws: WebSocket;
  private closed = false;
  constructor(path: '/ws/run' | '/ws/debug', start: Record<string, unknown>, private onMessage: (m: In) => void, private onClose: (error?: string) => void) {
    this.ws = new WebSocket(wsUrl(path));
    this.ws.onopen = () => this.ws.send(JSON.stringify({ type: 'start', ...start }));
    this.ws.onmessage = (ev) => {
      try {
        this.onMessage(JSON.parse(String(ev.data)) as In);
      } catch {
        /* ignore malformed */
      }
    };
    this.ws.onerror = () => {
      if (!this.closed) {
        this.closed = true;
        this.onClose('Connessione al server di esecuzione non riuscita');
      }
    };
    this.ws.onclose = () => {
      if (!this.closed) {
        this.closed = true;
        this.onClose();
      }
    };
  }
  send(msg: Record<string, unknown>): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
  close(): void {
    this.ws.close();
  }
  get open(): boolean {
    return !this.closed;
  }
}
