import { useEffect, useMemo, useRef, useState } from 'react';
import { Braces, BookOpen, Plus, Trash2, Search, Info, GitCompare, FileText, Terminal as TermIcon } from 'lucide-react';
import { Dialog, Empty, FileIcon, Logo } from '../common';
import { useApp, ui, updateSettings, openFile } from '../../stores/appStore';
import { BUILTIN_SNIPPETS } from '../../editor/snippets';
import { STD_FUNCTIONS, STD_HEADERS } from '../../editor/cStdlib';
import { COMMANDS, runCommand } from '../../features/commands/commands';
import { monaco } from '../../editor/monaco';
import { uid, modKey } from '../../utils/misc';
import { languageFor } from '../../utils/path';
import { useBackend } from '../../services/backendStatus';
import type { Snippet } from '../../types';

/* ───────────── Snippets ───────────── */
export function SnippetsDialog() {
  const custom = useApp((s) => s.settings.customSnippets);
  const [sel, setSel] = useState<string>(custom[0]?.id ?? BUILTIN_SNIPPETS[0]!.id);
  const all = [...custom, ...BUILTIN_SNIPPETS];
  const cur = all.find((s) => s.id === sel);
  const save = (list: Snippet[]) => void updateSettings({ customSnippets: list });
  const add = () => {
    const sn: Snippet = { id: uid('s'), prefix: 'nuovo', name: 'Nuovo snippet', description: '', body: '$0' };
    save([sn, ...custom]);
    setSel(sn.id);
  };
  const patch = (p: Partial<Snippet>) => cur && !cur.builtin && save(custom.map((s) => (s.id === cur.id ? { ...s, ...p } : s)));
  return (
    <Dialog title="Gestione snippet" icon={<Braces size={20} color="var(--primary)" />} size="wide" onClose={ui.closeDialog}>
      <div className="docs-layout" style={{ margin: -16, height: 'calc(100% + 32px)' }}>
        <div className="scroll" style={{ borderRight: '1px solid var(--border)' }}>
          <div className="pane"><button className="btn primary sm" onClick={add}><Plus size={14} /> Nuovo snippet</button></div>
          {custom.length > 0 && <div className="section-title">Personalizzati</div>}
          {custom.map((s) => (
            <div key={s.id} className={`list-item ${sel === s.id ? 'active' : ''}`} onClick={() => setSel(s.id)}><span className="kbd">{s.prefix}</span><span className="ellipsis">{s.name}</span></div>
          ))}
          <div className="section-title">Libreria C integrata</div>
          {BUILTIN_SNIPPETS.map((s) => (
            <div key={s.id} className={`list-item ${sel === s.id ? 'active' : ''}`} onClick={() => setSel(s.id)}><span className="kbd">{s.prefix}</span><span className="ellipsis">{s.name}</span></div>
          ))}
        </div>
        <div className="scroll pane" style={{ padding: 16 }}>
          {cur ? (
            <>
              {cur.builtin && <p className="muted" style={{ marginTop: 0 }}>Snippet integrato (sola lettura). Digita il prefisso nell’editor e conferma il suggerimento.</p>}
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                <div className="field grow"><label>Prefisso</label><input className="input mono" value={cur.prefix} disabled={cur.builtin} onChange={(e) => patch({ prefix: e.target.value.replace(/\s/g, '') })} /></div>
                <div className="field grow"><label>Nome</label><input className="input" value={cur.name} disabled={cur.builtin} onChange={(e) => patch({ name: e.target.value })} /></div>
              </div>
              <div className="field"><label>Descrizione</label><input className="input" value={cur.description} disabled={cur.builtin} onChange={(e) => patch({ description: e.target.value })} /></div>
              <div className="field">
                <label>Corpo</label>
                <textarea className="textarea" rows={10} value={cur.body} disabled={cur.builtin} spellCheck={false} onChange={(e) => patch({ body: e.target.value })} />
                <span className="hint">Segnaposto: <code>$1</code>, <code>${'{1:testo}'}</code>, cursore finale <code>$0</code>, tabulazione <code>\t</code>.</span>
              </div>
              {!cur.builtin && <button className="btn danger sm" onClick={() => { save(custom.filter((s) => s.id !== cur.id)); setSel(BUILTIN_SNIPPETS[0]!.id); }}><Trash2 size={14} /> Elimina snippet</button>}
            </>
          ) : <Empty title="Seleziona uno snippet" />}
        </div>
      </div>
    </Dialog>
  );
}

/* ───────────── Documentation ───────────── */
const GUIDES: { id: string; title: string; body: string }[] = [
  {
    id: 'primi-passi',
    title: 'Primi passi con C-Studio',
    body: `1. **Crea un progetto**: dalla schermata iniziale scegli *Nuovo progetto C* e un modello (es. *Hello World*).
2. **Scrivi il codice**: l’editor offre completamento (digita e scegli con Invio/Tab), firma dei parametri, tooltip sulle funzioni della libreria standard.
3. **Compila** con il pulsante *Compila* (F7): errori e warning compaiono in *Problems* e sottolineati nel codice. Tocca un problema per andare alla riga.
4. **Esegui** con *Compila ed esegui* (Ctrl+F5). Se il programma legge input (scanf, fgets), scrivi nella casella in fondo al pannello *Run* e premi Invio.
5. **Debug**: tocca il margine a sinistra dei numeri di riga per inserire un breakpoint, poi *Avvia debug* (F5). Usa Step Over (F10), Step Into (F11), Step Out (Shift+F11) e osserva variabili e stack.
6. **Salvataggio**: automatico (configurabile). Le modifiche non salvate vengono comunque recuperate se chiudi la pagina.
7. **Esporta** il progetto in ZIP da *Progetti → Esporta*.`,
  },
  {
    id: 'tablet',
    title: 'Usare C-Studio su tablet',
    body: `- La **barra dei simboli C** compare sopra la tastiera virtuale: { } [ ] ( ) ; # e frecce sono a un tocco. Si personalizza in *Impostazioni → Tastiera*.
- **Pressione prolungata** su file e cartelle apre il menu contestuale (rinomina, duplica, sposta, elimina…).
- In verticale la barra laterale è un **cassetto**: aprila con il pulsante ☰.
- Il pannello inferiore si **ridimensiona** trascinando il bordo e si apre a **schermo intero** con il pulsante ⤢.
- Con una **tastiera fisica** funzionano tutte le scorciatoie (Cmd/Ctrl+S, F5, F7, Cmd/Ctrl+P…).
- Installa C-Studio come app: in Safari *Condividi → Aggiungi alla schermata Home*; in Chrome *Installa app*.`,
  },
  {
    id: 'compilazione',
    title: 'Opzioni di compilazione',
    body: `La configurazione **Debug** predefinita equivale a \`gcc -std=c17 -Wall -Wextra -O0 -g\`. **Release** usa \`-O2 -DNDEBUG\` senza simboli di debug.

- \`-std=\`: standard del linguaggio (C89, C99, C11, C17, C23).
- \`-Wall -Wextra\`: abilitano i warning più utili. \`-pedantic\` segnala estensioni non standard; \`-Werror\` trasforma i warning in errori.
- \`-O0…-O3\`: livello di ottimizzazione. Per il debug usa \`-O0\` o \`-Og\`.
- \`-fsanitize=undefined\`: rileva a runtime comportamenti indefiniti (overflow di interi con segno, shift non validi…).
- \`-lm\`: necessario per le funzioni di \`math.h\`.

Ogni file \`.c\` viene compilato separatamente in un file oggetto, poi i file oggetto vengono collegati (linking). Gli header in qualsiasi cartella del progetto sono automaticamente nel percorso di include.`,
  },
  {
    id: 'errori',
    title: 'Errori di compilazione e di runtime',
    body: `**Errori di compilazione**: il codice non è C valido (es. \`;\` mancante, variabile non dichiarata). Il programma non viene creato.

**Errori di linking**: tutte le unità compilano, ma manca una definizione (\`undefined reference to 'f'\`): hai dichiarato una funzione senza implementarla o manca una libreria (\`-lm\`).

**Errori a runtime**: il programma compila ma fallisce durante l’esecuzione:
- \`SIGFPE\` — divisione intera per zero.
- \`SIGSEGV\` — accesso a memoria non valida (puntatore NULL, indice fuori dai limiti, ricorsione infinita).
- \`SIGABRT\` — \`abort()\` o \`assert\` fallito.
- *Timeout* — ciclo infinito o attesa di input oltre il limite.

C-Studio distingue sempre questi casi: un programma come \`x / 0\` compila (eventualmente con un warning) e viene segnalato come errore di runtime.`,
  },
  {
    id: 'puntatori',
    title: 'Promemoria: puntatori',
    body: `\`\`\`c
int x = 5;
int *p = &x;   // p contiene l'indirizzo di x
*p = 7;        // modifica x attraverso p
int a[3] = {1, 2, 3};
int *q = a;    // a "decade" a &a[0]
q[1] == *(q + 1);
\`\`\`
- Inizializza sempre i puntatori (anche a \`NULL\`).
- Ogni \`malloc\` deve avere il suo \`free\`; dopo \`free(p)\` imposta \`p = NULL\`.
- Non restituire l’indirizzo di una variabile locale.`,
  },
];

function md(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .split(/```(?:c)?\n([\s\S]*?)```/g)
    .map((part, i) =>
      i % 2 === 1
        ? `<pre>${esc(part)}</pre>`
        : esc(part)
            .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
            .replace(/\*([^*]+)\*/g, '<i>$1</i>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/^(\d+\.|-) (.*)$/gm, '<div style="margin:4px 0 4px 8px">$1 $2</div>')
            .replace(/\n\n/g, '<br/><br/>'),
    )
    .join('');
}

export function DocsDialog({ query }: { query?: string }) {
  const initialGuide = query?.startsWith('guida:') ? query.slice(6) : null;
  const [q, setQ] = useState(initialGuide ? '' : query ?? '');
  const [sel, setSel] = useState<string>(initialGuide ? `g:${initialGuide}` : query && STD_FUNCTIONS.some((f) => f.name === query) ? `f:${query}` : 'g:primi-passi');
  const fns = useMemo(() => STD_FUNCTIONS.filter((f) => !q || f.name.includes(q.toLowerCase()) || f.doc.toLowerCase().includes(q.toLowerCase()) || f.header.includes(q.toLowerCase())), [q]);
  const guides = GUIDES.filter((g) => !q || g.title.toLowerCase().includes(q.toLowerCase()) || g.body.toLowerCase().includes(q.toLowerCase()));
  const headers = Object.keys(STD_HEADERS).filter((h) => !q || h.includes(q.toLowerCase()) || fns.some((f) => f.header === h));
  let content: JSX.Element = <Empty title="Seleziona un argomento" />;
  if (sel.startsWith('g:')) {
    const g = GUIDES.find((x) => x.id === sel.slice(2));
    if (g) content = <><h2>{g.title}</h2><div dangerouslySetInnerHTML={{ __html: md(g.body) }} /></>;
  } else if (sel.startsWith('f:')) {
    const f = STD_FUNCTIONS.find((x) => x.name === sel.slice(2));
    if (f) content = (
      <>
        <h2 className="mono">{f.name}</h2>
        <pre>{`#include <${f.header}>\n\n${f.signature};`}</pre>
        <p>{f.doc}</p>
        {f.params.length > 0 && <><b>Parametri</b><ul>{f.params.map((p) => <li key={p}><code>{p}</code></li>)}</ul></>}
        {f.returns && <p><b>Valore restituito:</b> {f.returns}</p>}
        <p className="muted">Altre funzioni di <code>{f.header}</code>: {STD_FUNCTIONS.filter((x) => x.header === f.header && x.name !== f.name).slice(0, 14).map((x) => <a key={x.name} href="#" onClick={(e) => (e.preventDefault(), setSel(`f:${x.name}`))} style={{ marginRight: 8 }}>{x.name}</a>)}</p>
      </>
    );
  } else if (sel.startsWith('h:')) {
    const h = sel.slice(2);
    content = (
      <>
        <h2 className="mono">&lt;{h}&gt;</h2>
        <p>{STD_HEADERS[h]}</p>
        <div className="col" style={{ gap: 4 }}>
          {STD_FUNCTIONS.filter((f) => f.header === h).map((f) => (
            <a key={f.name} href="#" onClick={(e) => (e.preventDefault(), setSel(`f:${f.name}`))} className="mono">{f.signature}</a>
          ))}
        </div>
      </>
    );
  }
  return (
    <Dialog title="Documentazione C" icon={<BookOpen size={20} color="var(--primary)" />} size="full" onClose={ui.closeDialog}>
      <div className="docs-layout" style={{ margin: -16, height: 'calc(100% + 32px)' }}>
        <div className="scroll" style={{ borderRight: '1px solid var(--border)' }}>
          <div className="pane" style={{ position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 1 }}>
            <div className="row"><Search size={15} className="muted" /><input className="input grow" placeholder="Cerca funzione, header, guida…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
          </div>
          {guides.length > 0 && <div className="section-title">Guide rapide</div>}
          {guides.map((g) => <div key={g.id} className={`list-item ${sel === `g:${g.id}` ? 'active' : ''}`} onClick={() => setSel(`g:${g.id}`)}><FileText size={14} /> {g.title}</div>)}
          <div className="section-title">Header</div>
          {headers.map((h) => <div key={h} className={`list-item mono ${sel === `h:${h}` ? 'active' : ''}`} onClick={() => setSel(`h:${h}`)}>&lt;{h}&gt;</div>)}
          <div className="section-title">Funzioni ({fns.length})</div>
          {fns.map((f) => <div key={f.name} className={`list-item ${sel === `f:${f.name}` ? 'active' : ''}`} onClick={() => setSel(`f:${f.name}`)}><span className="mono">{f.name}</span><span className="muted" style={{ marginLeft: 'auto', fontSize: '0.85em' }}>{f.header}</span></div>)}
        </div>
        <div className="scroll docs-content" style={{ padding: '16px 22px' }}>{content}</div>
      </div>
    </Dialog>
  );
}

/* ───────────── Diff viewer ───────────── */
export function DiffDialog({ title, original, modified, path }: { title: string; original: string; modified: string; path: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [inline, setInline] = useState(window.innerWidth < 900);
  useEffect(() => {
    if (!host.current) return;
    const lang = languageFor(path);
    const a = monaco.editor.createModel(original, lang);
    const b = monaco.editor.createModel(modified, lang);
    const ed = monaco.editor.createDiffEditor(host.current, { readOnly: true, automaticLayout: true, renderSideBySide: !inline, originalEditable: false, minimap: { enabled: false }, fontSize: useApp.getState().settings.editorFontSize, scrollBeyondLastLine: false });
    ed.setModel({ original: a, modified: b });
    return () => {
      ed.dispose();
      a.dispose();
      b.dispose();
    };
  }, [original, modified, path, inline]);
  return (
    <Dialog title={title} icon={<GitCompare size={20} color="var(--primary)" />} size="full" onClose={ui.closeDialog} footer={<>
      <div className="seg"><button className={!inline ? 'on' : ''} onClick={() => setInline(false)}>Affiancato</button><button className={inline ? 'on' : ''} onClick={() => setInline(true)}>In linea</button></div>
      <span className="grow" />
      {useApp.getState().project?.files[path] !== undefined && <button className="btn" onClick={() => { ui.closeDialog(); openFile(path); }}>Apri file</button>}
      <button className="btn primary" onClick={ui.closeDialog}>Chiudi</button>
    </>}>
      <div ref={host} className="diff-host" style={{ margin: -16, height: 'calc(100% + 32px)' }} />
    </Dialog>
  );
}

/* ───────────── About ───────────── */
export function AboutDialog() {
  const h = useBackend((s) => s.health);
  return (
    <Dialog title="C-Studio" icon={<Logo size={28} className="" />} onClose={ui.closeDialog}>
      <p style={{ marginTop: 0 }}>IDE professionale per il linguaggio C, tablet-first. Versione 1.0.0.</p>
      <p className="muted">Editor: Monaco · Compilatori: GCC/Clang in sandbox · Debugger: GDB/MI · Archiviazione: IndexedDB · PWA installabile.</p>
      {h && <pre className="mono muted" style={{ fontSize: 12 }}>{`gcc:   ${h.toolchain.gcc.version || 'n/d'}\nclang: ${h.toolchain.clang.version || 'n/d'}\ngdb:   ${h.toolchain.gdb.version || 'n/d'}\nsandbox: ${h.sandbox.driver}`}</pre>}
    </Dialog>
  );
}

/* ───────────── Command palette / quick open ───────────── */
function fuzzy(q: string, s: string): number {
  if (!q) return 1;
  const a = q.toLowerCase();
  const b = s.toLowerCase();
  const idx = b.indexOf(a);
  if (idx >= 0) return 100 - idx;
  let i = 0;
  let score = 0;
  for (const ch of b) {
    if (ch === a[i]) {
      i++;
      score++;
    }
    if (i === a.length) return score;
  }
  return 0;
}

export function CommandPalette() {
  const mode = useApp((s) => s.palette);
  const project = useApp((s) => s.project);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setQ(mode === 'commands' ? '>' : '');
    setSel(0);
  }, [mode]);
  const isCmd = q.startsWith('>');
  const items = useMemo(() => {
    if (isCmd) {
      const term = q.slice(1).trim();
      return COMMANDS.map((c) => ({ c, score: fuzzy(term, `${c.category} ${c.label}`) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 60)
        .map(({ c }) => ({ key: c.id, label: c.label, detail: c.category, keys: c.keys, disabled: c.disabledReason?.() ?? null, icon: <TermIcon size={14} />, run: () => runCommand(c.id) }));
    }
    const files = Object.keys(project?.files ?? {});
    const [fileQ, lineQ] = q.split(':');
    return files
      .map((f) => ({ f, score: fuzzy(fileQ ?? '', f.split('/').pop()!) * 2 + fuzzy(fileQ ?? '', f) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)
      .map(({ f }) => ({ key: f, label: f.split('/').pop()!, detail: f, keys: undefined as string | undefined, disabled: null as string | null, icon: <FileIcon path={f} />, run: () => openFile(f, lineQ ? { line: Number(lineQ) || 1 } : {}) }));
  }, [q, isCmd, project]);
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    listRef.current?.children[sel]?.scrollIntoView({ block: 'nearest' });
  }, [sel]);
  if (!mode) return null;
  const choose = (i: number) => {
    const it = items[i];
    if (!it || it.disabled) return;
    ui.closePalette();
    it.run();
  };
  return (
    <div className="overlay" style={{ background: 'rgba(0,0,0,0.25)', alignItems: 'flex-start' }} onMouseDown={(e) => e.target === e.currentTarget && ui.closePalette()}>
      <div className="palette" role="dialog" aria-label="Ricerca globale">
        <input
          className="input"
          autoFocus
          value={q}
          placeholder={project ? `Cerca file per nome (aggiungi :riga) — digita > per i comandi` : 'Digita > per i comandi'}
          onChange={(e) => setQ(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(items.length - 1, s + 1)));
            else if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(0, s - 1)));
            else if (e.key === 'Enter') (e.preventDefault(), choose(sel));
            else if (e.key === 'Escape') ui.closePalette();
          }}
        />
        <div className="palette-list scroll" ref={listRef}>
          {items.length === 0 && <div className="pane muted">{isCmd ? 'Nessun comando' : project ? 'Nessun file trovato' : 'Apri un progetto per cercare i file, oppure digita > per i comandi'}</div>}
          {items.map((it, i) => (
            <div key={it.key} className={`palette-item ${i === sel ? 'sel' : ''} ${it.disabled ? 'disabled' : ''}`} title={it.disabled ?? ''} onMouseEnter={() => setSel(i)} onClick={() => choose(i)}>
              {it.icon}
              <span>{it.label}</span>
              <span className="muted ellipsis grow" style={{ fontSize: '0.88em' }}>{it.disabled ? `— ${it.disabled}` : it.detail}</span>
              {it.keys && <span className="kbd">{it.keys.replace('Ctrl', modKey)}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export { Info };
