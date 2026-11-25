import { Server, Cpu, Download } from 'lucide-react';
import { useApp } from '../stores/appStore';
import { useBackend } from '../services/backendStatus';
import { currentEngine, engineLabel } from '../services/engine';
import { useWasm, preloadBrowserCompiler } from '../features/wasm/browserEngine';
import { formatBytes } from '../utils/misc';

/** Shows which compiler engine is in use and the download state of the in-browser toolchain. */
export function EngineStatus() {
  useApp((s) => s.settings.compilerEngine);
  const backend = useBackend();
  const wasm = useWasm();
  const engine = currentEngine();
  const pct = wasm.total ? Math.round((wasm.loaded / wasm.total) * 100) : 0;
  return (
    <div className="status-card">
      {engine === 'browser' ? <Cpu size={18} /> : <Server size={18} />}
      <div className="grow">
        <div className="row" style={{ gap: 6 }}>
          <span className={`status-dot ${engine ? (engine === 'browser' && wasm.status === 'error' ? 'degraded' : 'online') : 'unavailable'}`} />
          <b>{engine ? `Compilatore: ${engineLabel(engine).toLowerCase()}` : 'Compilatore non disponibile'}</b>
        </div>
        <div className="muted" style={{ fontSize: '0.88em' }}>
          {engine === 'server' && backend.message}
          {engine === 'browser' && wasm.status === 'idle' && 'Clang reale in WebAssembly: si scarica al primo uso (~100 MB, poi resta in cache e funziona offline). Debugger e clang-format richiedono il server.'}
          {engine === 'browser' && wasm.status === 'loading' && `Download del compilatore… ${wasm.total ? `${pct}% (${formatBytes(wasm.loaded)} di ${formatBytes(wasm.total)})` : ''}`}
          {engine === 'browser' && wasm.status === 'ready' && 'Pronto: compila ed esegue il codice C direttamente in questo dispositivo.'}
          {engine === 'browser' && wasm.status === 'error' && `Errore: ${wasm.error}`}
          {!engine && backend.message}
        </div>
        {engine === 'browser' && wasm.status === 'loading' && wasm.total > 0 && (
          <div className="progress" style={{ marginTop: 6 }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--primary)' }} />
          </div>
        )}
      </div>
      {engine === 'browser' && wasm.status === 'idle' && (
        <button className="btn sm" onClick={preloadBrowserCompiler}><Download size={14} /> Scarica ora</button>
      )}
      {engine !== 'browser' && <button className="btn sm" onClick={() => void backend.refresh()}>Verifica</button>}
    </div>
  );
}
