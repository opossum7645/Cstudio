import { ReactNode, useEffect, useState } from 'react';
import { Palette, Code2, Cpu, Keyboard, FolderCog, Shield, Settings as Gear, RotateCcw } from 'lucide-react';
import { Dialog, Toggle } from '../common';
import { useApp, ui, updateSettings, updateProject, activeBuildConfig, refreshProjects } from '../../stores/appStore';
import { UI_THEMES, SYNTAX_SCHEMES } from '../../features/settings/themes';
import { DEFAULT_SETTINGS, DEFAULT_TABLET_KEYS } from '../../features/settings/defaults';
import { useBackend } from '../../services/backendStatus';
import { EngineStatus } from '../EngineStatus';
import { configSummary } from '../../features/compiler/buildStore';
import { COMMANDS } from '../../features/commands/commands';
import { releaseFrom } from '../../features/projects/templates';
import { dbClearAll } from '../../services/db';
import { confirmYes, toast } from '../../stores/uiFeedback';
import { formatBytes, modKey } from '../../utils/misc';
import { projectRepo } from '../../features/projects/projectRepo';
import type { BuildConfig, CStandard, OptLevel, Settings, SyntaxScheme, UiTheme } from '../../types';

const CATS = [
  { id: 'appearance', label: 'Aspetto e temi', icon: Palette },
  { id: 'editor', label: 'Editor', icon: Code2 },
  { id: 'compiler', label: 'Compilatore', icon: Cpu },
  { id: 'keyboard', label: 'Tastiera', icon: Keyboard },
  { id: 'workspace', label: 'Workspace', icon: FolderCog },
  { id: 'privacy', label: 'Privacy e sicurezza', icon: Shield },
] as const;

function Row({ label, desc, children }: { label: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="lbl">
        <div>{label}</div>
        {desc && <div className="d">{desc}</div>}
      </div>
      <div className="ctl">{children}</div>
    </div>
  );
}

function Num({ value, min, max, step = 1, onChange, suffix }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <input className="input" type="number" style={{ width: 84 }} value={value} min={min} max={max} step={step} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v))); }} />
      {suffix && <span className="muted">{suffix}</span>}
    </span>
  );
}

const PRIMARY_SWATCHES = ['#6C8CFF', '#8B7CFF', '#42A5F5', '#26C6DA', '#42D6B0', '#7CB342', '#FFB74D', '#FF7A85', '#F06292'];
const ACCENT_SWATCHES = ['#42D6B0', '#4DD0E1', '#81C784', '#FFD54F', '#FF8A65', '#BA68C8', '#6C8CFF'];

export function SettingsDialog({ category }: { category?: string }) {
  const [cat, setCat] = useState<string>(category ?? 'appearance');
  const s = useApp((st) => st.settings);
  const set = (patch: Partial<Settings>) => void updateSettings(patch);

  return (
    <Dialog title="Impostazioni" icon={<Gear size={20} color="var(--primary)" />} size="full" onClose={ui.closeDialog}>
      <div className="settings-layout" style={{ margin: -16, height: 'calc(100% + 32px)' }}>
        <nav className="settings-nav" aria-label="Categorie impostazioni">
          {CATS.map((c) => (
            <button key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)}>
              <c.icon size={16} /> {c.label}
            </button>
          ))}
        </nav>
        <div className="settings-content scroll">
          {cat === 'appearance' && <Appearance s={s} set={set} />}
          {cat === 'editor' && <EditorSettings s={s} set={set} />}
          {cat === 'compiler' && <CompilerSettings s={s} set={set} />}
          {cat === 'keyboard' && <KeyboardSettings s={s} set={set} />}
          {cat === 'workspace' && <WorkspaceSettings s={s} set={set} />}
          {cat === 'privacy' && <PrivacySettings s={s} set={set} />}
        </div>
      </div>
    </Dialog>
  );
}

type P = { s: Settings; set: (p: Partial<Settings>) => void };

function Appearance({ s, set }: P) {
  return (
    <>
      <h3>Tema interfaccia</h3>
      <div className="card-grid" style={{ marginTop: 10 }}>
        {(Object.keys(UI_THEMES) as UiTheme[]).map((t) => {
          const th = UI_THEMES[t];
          return (
            <button key={t} className={`card ${s.theme === t ? 'on' : ''}`} onClick={() => set({ theme: t })} aria-pressed={s.theme === t}>
              <div className="theme-preview" style={{ background: th.editor, color: th.text, borderColor: th.border }}>
                <span style={{ color: s.primaryColor }}>#include</span> <span style={{ color: th.textMuted }}>&lt;stdio.h&gt;</span>
                <br />
                <span style={{ color: s.accentColor }}>int</span> main(<span style={{ color: s.accentColor }}>void</span>) {'{'}
              </div>
              <h4>{th.label}</h4>
            </button>
          );
        })}
      </div>
      <h3>Colori</h3>
      <Row label="Colore primario" desc="Pulsanti, selezioni, cursore">
        <div className="swatches">
          {PRIMARY_SWATCHES.map((c) => <button key={c} className={`swatch ${s.primaryColor.toLowerCase() === c.toLowerCase() ? 'on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => set({ primaryColor: c })} />)}
          <input type="color" value={s.primaryColor} onChange={(e) => set({ primaryColor: e.target.value })} aria-label="Colore primario personalizzato" />
        </div>
      </Row>
      <Row label="Colore di accento" desc="Esecuzione, stati positivi">
        <div className="swatches">
          {ACCENT_SWATCHES.map((c) => <button key={c} className={`swatch ${s.accentColor.toLowerCase() === c.toLowerCase() ? 'on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => set({ accentColor: c })} />)}
          <input type="color" value={s.accentColor} onChange={(e) => set({ accentColor: e.target.value })} aria-label="Colore di accento personalizzato" />
        </div>
      </Row>
      <h3>Evidenziazione della sintassi</h3>
      <div className="card-grid" style={{ marginTop: 10 }}>
        {(Object.keys(SYNTAX_SCHEMES) as SyntaxScheme[]).map((k) => {
          const sc = SYNTAX_SCHEMES[k];
          const c = UI_THEMES[s.theme].isDark ? sc.dark : sc.light;
          return (
            <button key={k} className={`card ${s.syntaxScheme === k ? 'on' : ''}`} onClick={() => set({ syntaxScheme: k })}>
              <div className="theme-preview" style={{ background: UI_THEMES[s.theme].editor }}>
                <span style={{ color: '#' + c.preprocessor }}>#define</span> <span style={{ color: '#' + c.identifier }}>N</span> <span style={{ color: '#' + c.number }}>10</span>
                <br />
                <span style={{ color: '#' + c.type }}>int</span> <span style={{ color: '#' + c.func }}>f</span>(<span style={{ color: '#' + c.keyword }}>const</span> <span style={{ color: '#' + c.type }}>char</span> *s) <span style={{ color: '#' + c.comment }}>// ok</span>
              </div>
              <h4>{sc.label}</h4>
            </button>
          );
        })}
      </div>
      <h3>Interfaccia</h3>
      <Row label="Densità" desc="“Automatica” usa la modalità touch su tablet e smartphone">
        <select className="select" value={s.density} onChange={(e) => set({ density: e.target.value as Settings['density'] })}>
          <option value="auto">Automatica</option>
          <option value="compact">Compatta</option>
          <option value="comfortable">Comoda</option>
          <option value="touch">Touch</option>
        </select>
      </Row>
      <Row label="Dimensione testo interfaccia"><Num value={s.uiFontSize} min={11} max={18} onChange={(v) => set({ uiFontSize: v })} suffix="px" /></Row>
      <Row label="Animazioni" desc="Transizioni leggere di pannelli e dialoghi"><Toggle on={s.animations} onChange={(v) => set({ animations: v })} /></Row>
      <div style={{ marginTop: 16 }}>
        <button className="btn" onClick={() => set({ theme: DEFAULT_SETTINGS.theme, primaryColor: DEFAULT_SETTINGS.primaryColor, accentColor: DEFAULT_SETTINGS.accentColor, syntaxScheme: DEFAULT_SETTINGS.syntaxScheme, uiFontSize: DEFAULT_SETTINGS.uiFontSize, density: 'auto' })}>
          <RotateCcw size={14} /> Ripristina aspetto predefinito
        </button>
      </div>
    </>
  );
}

function EditorSettings({ s, set }: P) {
  const fonts = [DEFAULT_SETTINGS.editorFontFamily, "'Fira Code', monospace", "'Source Code Pro', monospace", "Menlo, monospace", "Consolas, monospace", "'Courier New', monospace"];
  return (
    <>
      <h3>Testo</h3>
      <Row label="Font" desc="Usato se installato sul dispositivo">
        <select className="select" value={s.editorFontFamily} onChange={(e) => set({ editorFontFamily: e.target.value })} style={{ maxWidth: 260 }}>
          {fonts.map((f) => <option key={f} value={f}>{f.split(',')[0]!.replace(/'/g, '')}</option>)}
        </select>
      </Row>
      <Row label="Dimensione carattere"><Num value={s.editorFontSize} min={9} max={32} onChange={(v) => set({ editorFontSize: v })} suffix="px" /></Row>
      <Row label="Word wrap"><Toggle on={s.wordWrap} onChange={(v) => set({ wordWrap: v })} /></Row>
      <Row label="Numeri di riga"><Toggle on={s.lineNumbers} onChange={(v) => set({ lineNumbers: v })} /></Row>
      <Row label="Minimap" desc="Nascosta automaticamente sui dispositivi touch"><Toggle on={s.minimap} onChange={(v) => set({ minimap: v })} /></Row>
      <Row label="Mostra spazi bianchi"><Toggle on={s.renderWhitespace} onChange={(v) => set({ renderWhitespace: v })} /></Row>
      <Row label="Colorazione coppie di parentesi"><Toggle on={s.bracketColors} onChange={(v) => set({ bracketColors: v })} /></Row>
      <Row label="Sticky scroll" desc="Mantiene visibile l’intestazione della funzione corrente"><Toggle on={s.stickyScroll} onChange={(v) => set({ stickyScroll: v })} /></Row>
      <h3>Indentazione</h3>
      <Row label="Dimensione tab"><Num value={s.tabSize} min={1} max={8} onChange={(v) => set({ tabSize: v })} /></Row>
      <Row label="Indenta con spazi"><Toggle on={s.insertSpaces} onChange={(v) => set({ insertSpaces: v })} /></Row>
      <Row label="Chiusura automatica di parentesi e virgolette"><Toggle on={s.autoClosingBrackets} onChange={(v) => set({ autoClosingBrackets: v })} /></Row>
      <Row label="Code folding"><Toggle on={s.folding} onChange={(v) => set({ folding: v })} /></Row>
      <h3>Salvataggio e formattazione</h3>
      <Row label="Salvataggio automatico" desc="Le modifiche non salvate sono comunque protette da recupero automatico">
        <select className="select" value={s.autoSave} onChange={(e) => set({ autoSave: e.target.value as Settings['autoSave'] })}>
          <option value="off">Disattivato</option>
          <option value="afterDelay">Dopo un ritardo</option>
          <option value="onFocusChange">Al cambio di file/finestra</option>
        </select>
      </Row>
      {s.autoSave === 'afterDelay' && <Row label="Ritardo salvataggio automatico"><Num value={s.autoSaveDelay} min={300} max={30000} step={100} onChange={(v) => set({ autoSaveDelay: v })} suffix="ms" /></Row>}
      <Row label="Formatta al salvataggio" desc="Richiede clang-format sul server"><Toggle on={s.formatOnSave} onChange={(v) => set({ formatOnSave: v })} /></Row>
      <Row label="Stile clang-format">
        <select className="select" value={s.formatStyle} onChange={(e) => set({ formatStyle: e.target.value as Settings['formatStyle'] })}>
          {['LLVM', 'Google', 'Mozilla', 'WebKit', 'GNU', 'Microsoft'].map((x) => <option key={x}>{x}</option>)}
        </select>
      </Row>
    </>
  );
}

function ConfigEditor({ cfg, onChange }: { cfg: BuildConfig; onChange: (c: BuildConfig) => void }) {
  const [flags, setFlags] = useState(cfg.extraFlags.join(' '));
  const [defines, setDefines] = useState(cfg.defines.join(' '));
  useEffect(() => {
    setFlags(cfg.extraFlags.join(' '));
    setDefines(cfg.defines.join(' '));
  }, [cfg]);
  const h = useBackend((b) => b.health);
  const w = (k: keyof BuildConfig['warnings'], v: boolean) => onChange({ ...cfg, warnings: { ...cfg.warnings, [k]: v } });
  const lib = (l: string, on: boolean) => onChange({ ...cfg, libraries: on ? [...new Set([...cfg.libraries, l])] : cfg.libraries.filter((x) => x !== l) });
  return (
    <>
      <Row label="Compilatore">
        <select className="select" value={cfg.compiler} onChange={(e) => onChange({ ...cfg, compiler: e.target.value as BuildConfig['compiler'] })}>
          <option value="gcc" disabled={h ? !h.toolchain.gcc.available : false}>GCC{h?.toolchain.gcc.version ? ` — ${h.toolchain.gcc.version.replace(/^gcc \S+ /, '')}` : ''}</option>
          <option value="clang" disabled={h ? !h.toolchain.clang.available : false}>Clang{h?.toolchain.clang.version ? ` — ${h.toolchain.clang.version.replace(/^.*clang version /, '')}` : ''}</option>
        </select>
      </Row>
      <Row label="Standard C">
        <select className="select" value={cfg.std} onChange={(e) => onChange({ ...cfg, std: e.target.value as CStandard })}>
          {(['c89', 'c99', 'c11', 'c17', 'c23', 'gnu11', 'gnu17'] as CStandard[]).map((x) => <option key={x} value={x}>{x.toUpperCase()}{x === 'c23' ? ' (-std=c2x)' : ''}</option>)}
        </select>
      </Row>
      <Row label="Ottimizzazione">
        <select className="select" value={cfg.optimization} onChange={(e) => onChange({ ...cfg, optimization: e.target.value as OptLevel })}>
          {(['O0', 'Og', 'O1', 'O2', 'O3', 'Os'] as OptLevel[]).map((x) => <option key={x} value={x}>-{x}</option>)}
        </select>
      </Row>
      <Row label="Informazioni di debug (-g)"><Toggle on={cfg.debugInfo} onChange={(v) => onChange({ ...cfg, debugInfo: v })} /></Row>
      <Row label="-Wall"><Toggle on={cfg.warnings.all} onChange={(v) => w('all', v)} /></Row>
      <Row label="-Wextra"><Toggle on={cfg.warnings.extra} onChange={(v) => w('extra', v)} /></Row>
      <Row label="-pedantic"><Toggle on={cfg.warnings.pedantic} onChange={(v) => w('pedantic', v)} /></Row>
      <Row label="Warning come errori (-Werror)"><Toggle on={cfg.warnings.asErrors} onChange={(v) => w('asErrors', v)} /></Row>
      <Row label="UndefinedBehaviorSanitizer" desc="-fsanitize=undefined: rileva overflow, shift non validi… a runtime"><Toggle on={cfg.sanitizeUndefined} onChange={(v) => onChange({ ...cfg, sanitizeUndefined: v })} /></Row>
      <Row label="Libreria matematica (-lm)"><Toggle on={cfg.libraries.includes('m')} onChange={(v) => lib('m', v)} /></Row>
      <Row label="POSIX threads (-lpthread)"><Toggle on={cfg.libraries.includes('pthread')} onChange={(v) => lib('pthread', v)} /></Row>
      <div className="field" style={{ marginTop: 12 }}>
        <label>Macro (-D), separate da spazi</label>
        <input className="input mono" value={defines} placeholder="DEBUG LIVELLO=2" onChange={(e) => setDefines(e.target.value)} onBlur={() => onChange({ ...cfg, defines: defines.split(/\s+/).filter(Boolean) })} />
      </div>
      <div className="field">
        <label>Flag personalizzati</label>
        <input className="input mono" value={flags} placeholder="-Wshadow -Wconversion" onChange={(e) => setFlags(e.target.value)} onBlur={() => onChange({ ...cfg, extraFlags: flags.split(/\s+/).filter(Boolean) })} />
        <span className="hint">Consentiti per sicurezza: -W…, -D…, -U…, -g…, -pedantic, -ansi, alcuni -f… (es. -fno-builtin, -fwrapv). Flag non consentiti vengono rifiutati dal server con un messaggio.</span>
      </div>
      <div className="field">
        <span className="field-label">Riga di comando risultante</span>
        <code className="mono" style={{ background: 'var(--editor)', padding: 10, borderRadius: 8, border: '1px solid var(--border)', wordBreak: 'break-all' }}>{configSummary(cfg)}</code>
      </div>
    </>
  );
}

function CompilerSettings({ s, set }: P) {
  const project = useApp((st) => st.project);
  const backend = useBackend();
  const [url, setUrl] = useState(s.backendUrl);
  const [which, setWhich] = useState<'debug' | 'release'>(project?.activeConfig ?? 'debug');
  const cfg = project ? project.buildConfigs[which] : s.defaultBuildConfig;
  return (
    <>
      <h3>Motore di compilazione</h3>
      <Row label="Dove compilare ed eseguire" desc="Automatico: usa il server quando è raggiungibile, altrimenti il compilatore nel browser">
        <select className="select" value={s.compilerEngine} onChange={(e) => set({ compilerEngine: e.target.value as Settings['compilerEngine'] })}>
          <option value="auto">Automatico</option>
          <option value="server">Solo server C-Studio</option>
          <option value="browser">Solo nel browser (Clang WebAssembly)</option>
        </select>
      </Row>
      <EngineStatus />
      <p className="muted" style={{ fontSize: '0.88em' }}>Nel browser: Clang 22 reale compilato in WebAssembly (target wasm32-wasi). Il programma gira isolato in un Web Worker; un ciclo infinito viene fermato dal timeout. Non disponibili nel browser: debugger GDB, clang-format, thread POSIX, fork/segnali/socket.</p>
      <h3>Server di compilazione</h3>
      <Row label="Stato" desc={backend.message}>
        <span className={`status-dot ${backend.status}`} />
        <button className="btn sm" onClick={() => void backend.refresh()}>Verifica</button>
      </Row>
      <div className="field" style={{ marginTop: 10 }}>
        <label>URL del backend</label>
        <div className="row">
          <input className="input grow mono" value={url} placeholder="(stessa origine) es. https://cstudio.example.com" onChange={(e) => setUrl(e.target.value)} />
          <button className="btn" onClick={async () => { set({ backendUrl: url }); await new Promise((r) => setTimeout(r, 50)); await useBackend.getState().refresh(); }}>Applica</button>
        </div>
        <span className="hint">Lascia vuoto se il backend serve anche l’interfaccia. Il codice viene compilato ed eseguito in una sandbox isolata (nessuna rete, limiti di CPU, memoria, processi e tempo).</span>
      </div>
      {backend.health && (
        <div className="field">
          <span className="field-label">Toolchain del server</span>
          <div className="muted mono" style={{ fontSize: 12 }}>
            {Object.entries(backend.health.toolchain).map(([k, v]) => <div key={k}>{k}: {v.available ? v.version : 'non disponibile'}</div>)}
            <div>sandbox: {backend.health.sandbox.driver} — {backend.health.sandbox.detail}</div>
          </div>
        </div>
      )}
      <h3>Esecuzione</h3>
      <Row label="Timeout di esecuzione" desc={`Tempo massimo (reale) di un programma; massimo consentito dal server: ${backend.health ? backend.health.limits.runWallMaxMs / 1000 : 300}s. Il limite di CPU è ${backend.health?.limits.runCpuSeconds ?? 5}s.`}>
        <Num value={s.runTimeoutSec} min={1} max={(backend.health?.limits.runWallMaxMs ?? 300000) / 1000} onChange={(v) => set({ runTimeoutSec: v })} suffix="s" />
      </Row>
      {project && (
        <Row label="Argomenti del programma" desc="Passati a main(argc, argv)">
          <input className="input mono" style={{ width: 240 }} value={project.runArgs} onChange={(e) => void updateProject({ runArgs: e.target.value })} placeholder="arg1 arg2" />
        </Row>
      )}
      <Row label="Diagnostica automatica" desc="Compila in background dopo ogni salvataggio per mostrare errori e warning"><Toggle on={s.liveDiagnostics} onChange={(v) => set({ liveDiagnostics: v })} /></Row>

      <h3>{project ? `Configurazioni del progetto “${project.name}”` : 'Configurazione predefinita per i nuovi progetti'}</h3>
      {project && (
        <div className="row" style={{ margin: '8px 0' }}>
          <div className="seg">
            <button className={which === 'debug' ? 'on' : ''} onClick={() => setWhich('debug')}>Debug</button>
            <button className={which === 'release' ? 'on' : ''} onClick={() => setWhich('release')}>Release</button>
          </div>
          <span className="muted">Attiva: {project.activeConfig === 'debug' ? 'Debug' : 'Release'}</span>
          {project.activeConfig !== which && <button className="btn sm" onClick={() => void updateProject({ activeConfig: which })}>Imposta come attiva</button>}
        </div>
      )}
      <ConfigEditor
        cfg={cfg}
        onChange={(c) => {
          if (project) void updateProject({ buildConfigs: { ...project.buildConfigs, [which]: c } });
          else set({ defaultBuildConfig: c });
        }}
      />
      {project && (
        <button className="btn" style={{ marginTop: 8 }} onClick={() => void updateProject({ buildConfigs: { debug: { ...s.defaultBuildConfig, mode: 'debug' }, release: releaseFrom(s.defaultBuildConfig) } })}>
          <RotateCcw size={14} /> Ripristina configurazioni predefinite ({configSummary(activeBuildConfig()).split(' ').slice(0, 3).join(' ')}…)
        </button>
      )}
    </>
  );
}

function KeyboardSettings({ s, set }: P) {
  const [keys, setKeys] = useState(s.tabletKeySet);
  const bound = COMMANDS.filter((c) => c.keys);
  return (
    <>
      <h3>Tastiera rapida per tablet</h3>
      <Row label="Mostra la barra dei simboli C" desc="Automatico: solo su dispositivi touch, quando l’editor è attivo">
        <select className="select" value={s.tabletKeys} onChange={(e) => set({ tabletKeys: e.target.value as Settings['tabletKeys'] })}>
          <option value="auto">Automatico</option>
          <option value="always">Sempre</option>
          <option value="never">Mai</option>
        </select>
      </Row>
      <div className="field" style={{ marginTop: 10 }}>
        <label>Tasti (separati da spazi)</label>
        <textarea className="textarea" rows={3} value={keys} onChange={(e) => setKeys(e.target.value)} />
        <span className="hint">Speciali: TAB S-TAB ← → ↑ ↓ HOME END UNDO REDO COPY PASTE CUT FIND SAVE COMMENT FORMAT SELALL. Qualsiasi altro testo viene inserito al cursore (es. <code>printf</code>, <code>-&gt;</code>, <code>&amp;&amp;</code>).</span>
        <div className="row">
          <button className="btn primary sm" onClick={() => set({ tabletKeySet: keys })}>Salva</button>
          <button className="btn sm" onClick={() => { setKeys(DEFAULT_TABLET_KEYS); set({ tabletKeySet: DEFAULT_TABLET_KEYS }); }}>Ripristina</button>
        </div>
      </div>
      <h3>Scorciatoie da tastiera</h3>
      <p className="muted" style={{ marginTop: 0 }}>Con una tastiera fisica collegata (anche su iPad) funzionano tutte le scorciatoie dell’editor ({modKey}+F, {modKey}+Z, {modKey}+/, Alt+clic per multi-cursore…) e queste:</p>
      {bound.map((c) => (
        <div key={c.id} className="setting-row" style={{ padding: '6px 0' }}>
          <span className="lbl">{c.label} <span className="muted">· {c.category}</span></span>
          <span className="kbd">{c.keys!.replace('Ctrl', modKey)}</span>
        </div>
      ))}
    </>
  );
}

function WorkspaceSettings({ s, set }: P) {
  return (
    <>
      <h3>Avvio</h3>
      <Row label="All’avvio">
        <select className="select" value={s.startup} onChange={(e) => set({ startup: e.target.value as Settings['startup'] })}>
          <option value="lastProject">Riapri l’ultimo progetto e le sue schede</option>
          <option value="welcome">Mostra la schermata iniziale</option>
        </select>
      </Row>
      <h3>Progetti</h3>
      <Row label="Progetti recenti da mostrare"><Num value={s.recentLimit} min={1} max={50} onChange={(v) => set({ recentLimit: v })} /></Row>
      <Row label="Svuota l’elenco dei recenti"><button className="btn sm" onClick={async () => { await projectRepo.clearRecent(); toast('info', 'Elenco dei recenti svuotato'); }}>Svuota</button></Row>
      <Row label="Conferma prima di eliminare file"><Toggle on={s.confirmDelete} onChange={(v) => set({ confirmDelete: v })} /></Row>
      <h3>Backup e ripristino</h3>
      <Row label="Crea un backup di tutti i progetti" desc="Un file ZIP ripristinabile da Importa → Ripristina backup"><button className="btn sm" onClick={() => ui.openDialog({ kind: 'export' })}>Backup…</button></Row>
      <Row label="Ripristina da backup"><button className="btn sm" onClick={() => ui.openDialog({ kind: 'import' })}>Ripristina…</button></Row>
      <Row label="Recupero delle modifiche non salvate" desc="Sempre attivo: le modifiche vengono salvate come bozza ogni secondo e recuperate alla riapertura">
        <span className="chip ok">Attivo</span>
      </Row>
    </>
  );
}

function PrivacySettings({ s }: P) {
  const [usage, setUsage] = useState<string>('…');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const backend = useBackend();
  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => setUsage(`${formatBytes(e.usage ?? 0)} usati di ${formatBytes(e.quota ?? 0)} disponibili`)).catch(() => setUsage('non disponibile'));
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);
  void s;
  return (
    <>
      <h3>Dati locali</h3>
      <p className="muted" style={{ marginTop: 0 }}>Progetti, impostazioni, bozze e cronologia locale sono salvati solo in questo browser (IndexedDB). Nessun account, nessuna telemetria.</p>
      <Row label="Spazio utilizzato" desc={usage}><span /></Row>
      <Row label="Archiviazione persistente" desc="Evita che il browser cancelli i dati quando lo spazio scarseggia">
        {persisted ? <span className="chip ok">Attiva</span> : <button className="btn sm" onClick={async () => { const ok = await navigator.storage?.persist?.(); setPersisted(!!ok); toast(ok ? 'success' : 'warning', ok ? 'Archiviazione persistente attivata' : 'Il browser non ha concesso l’archiviazione persistente'); }}>Richiedi</button>}
      </Row>
      <Row label="Elimina tutti i dati locali" desc="Cancella progetti, impostazioni e cronologia da questo dispositivo">
        <button className="btn danger sm" onClick={async () => {
          if (!(await confirmYes({ title: 'Eliminare tutti i dati?', message: 'Tutti i progetti e le impostazioni di C-Studio su questo dispositivo verranno eliminati definitivamente. Esporta prima un backup se ti servono.', confirmLabel: 'Elimina tutto', danger: true }))) return;
          await dbClearAll();
          useApp.setState({ project: null, buffers: {}, screen: 'welcome', dialog: null });
          await refreshProjects();
          toast('info', 'Dati locali eliminati');
        }}>Elimina tutto</button>
      </Row>
      <h3>Sicurezza dell’esecuzione</h3>
      <p className="muted" style={{ marginTop: 0 }}>Il codice C non viene mai eseguito nel browser né direttamente sul server principale: ogni compilazione ed esecuzione avviene in una sandbox temporanea, eliminata al termine.</p>
      {backend.health ? (
        <div className="mono muted" style={{ fontSize: 12.5, lineHeight: 1.8 }}>
          <div>Isolamento: {backend.health.sandbox.driver} — {backend.health.sandbox.detail}</div>
          <div>Rete: disabilitata · Filesystem: directory temporanea privata</div>
          <div>CPU: {backend.health.limits.runCpuSeconds}s · Memoria: {formatBytes(backend.health.limits.memoryBytes)} · Output: {formatBytes(backend.health.limits.maxOutputBytes)}</div>
          <div>Tempo reale: {backend.health.limits.runWallDefaultMs / 1000}s (max {backend.health.limits.runWallMaxMs / 1000}s) · Compilazione: {backend.health.limits.compileTimeoutMs / 1000}s</div>
        </div>
      ) : (
        <p className="warn">Server non raggiungibile: i limiti non possono essere mostrati.</p>
      )}
      <h3>Connessioni</h3>
      <Row label="Server di compilazione" desc={backend.message}><span className={`status-dot ${backend.status}`} /></Row>
      <Row label="Connessione di rete" desc={navigator.onLine ? 'Online' : 'Offline'}><span className={`status-dot ${navigator.onLine ? 'online' : 'offline'}`} /></Row>
    </>
  );
}
