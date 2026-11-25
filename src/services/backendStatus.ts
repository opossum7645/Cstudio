/** Tracks connectivity and capabilities of the compiler backend. */
import { create } from 'zustand';
import type { HealthInfo } from '../types';
import { api } from './api';

interface BackendState {
  status: 'checking' | 'online' | 'offline' | 'unavailable' | 'degraded';
  available: boolean;
  message: string;
  health: HealthInfo | null;
  checkedAt: number;
  refresh(): Promise<void>;
}

export const useBackend = create<BackendState>((set) => ({
  status: 'checking',
  available: false,
  message: 'Verifica del server di compilazione…',
  health: null,
  checkedAt: 0,
  async refresh() {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      set({ status: 'offline', available: false, message: 'Sei offline: compilazione ed esecuzione richiedono il server', checkedAt: Date.now() });
      return;
    }
    try {
      const h = await api.health();
      if (!h.sandbox.ok) {
        set({ status: 'degraded', available: false, health: h, message: `Sandbox non operativa sul server: ${h.sandbox.detail}`, checkedAt: Date.now() });
      } else if (!h.ok) {
        set({ status: 'degraded', available: false, health: h, message: 'Nessun compilatore C disponibile sul server', checkedAt: Date.now() });
      } else {
        set({ status: 'online', available: true, health: h, message: `Server online — ${h.toolchain.gcc.version || h.toolchain.clang.version}`, checkedAt: Date.now() });
      }
    } catch (e) {
      set({ status: 'unavailable', available: false, health: null, message: (e as Error).message || 'Server di compilazione non raggiungibile', checkedAt: Date.now() });
    }
  },
}));

let timer: ReturnType<typeof setInterval> | null = null;
export function startBackendMonitor(): void {
  void useBackend.getState().refresh();
  if (timer) return;
  timer = setInterval(() => void useBackend.getState().refresh(), 30_000);
  window.addEventListener('online', () => void useBackend.getState().refresh());
  window.addEventListener('offline', () => void useBackend.getState().refresh());
}
