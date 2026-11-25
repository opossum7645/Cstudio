# C-Studio — Professional C IDE

IDE web per il linguaggio C, tablet-first, con editor Monaco, compilazione **reale** GCC/Clang in sandbox sul server **oppure direttamente nel browser** (Clang in WebAssembly), esecuzione interattiva, debugger **GDB reale**, terminale integrato, controllo versione locale e funzionamento offline (PWA).

## Provalo subito (GitHub Pages)

L’app è pubblicata da GitHub Actions su **https://opossum7645.github.io/Cstudio/**. Senza server il codice viene compilato ed eseguito **nel browser** con Clang 22 reale compilato in WebAssembly ([YoWASP](https://yowasp.org/)): al primo uso scarica il compilatore (~100 MB, ~23 MB compressi), poi resta in cache e funziona anche offline. Il debugger GDB e clang-format richiedono il server.

## Motori di compilazione

| | Server C-Studio | Nel browser |
|---|---|---|
| Compilatore | GCC 13 / Clang 18 (Linux x86-64) | Clang 22 → WebAssembly (wasm32-wasi) |
| Esecuzione | processo in sandbox | Web Worker isolato |
| Input interattivo | sì | sì (tramite service worker) |
| Debugger GDB | sì | no |
| clang-format | sì | no |
| Thread, fork, segnali, socket | sì (nei limiti della sandbox) | no (non supportati da WASI) |
| Errori runtime | segnali reali (SIGFPE, SIGSEGV…) | trap WebAssembly mappate sui segnali equivalenti |

*Impostazioni → Compilatore → Dove compilare ed eseguire*: **Automatico** (server se raggiungibile, altrimenti browser), **Solo server**, **Solo browser**.

## Avvio rapido (con server)

Requisiti: Node.js ≥ 20, Linux con `gcc`, `clang` (opzionale), `gdb`, `clang-format` (opzionale), `util-linux` (`unshare`, `setpriv`, `prlimit`). Il backend in modalità sandbox *native* deve girare come **root** (usa namespace Linux e cambia uid per ogni job).

```bash
npm install
npm --prefix backend install

# sviluppo (due terminali)
sudo npm --prefix backend run dev        # backend su :8787
npm run dev                              # frontend su :5173 (proxy /api e /ws → :8787)

# produzione: un solo processo serve UI + API
npm run build
npm --prefix backend run build
sudo CSTUDIO_STATIC=$PWD/dist node backend/dist/server.js   # http://localhost:8787
```

### Produzione con Docker (consigliato)

```bash
docker build -t cstudio-sandbox:latest backend/sandbox     # immagine per ogni compile/run/debug
docker build -f backend/Dockerfile -t cstudio .
docker run -p 8787:8787 -v /var/run/docker.sock:/var/run/docker.sock \
  -v /var/cstudio-jobs:/var/cstudio-jobs cstudio
```

Con `CSTUDIO_SANDBOX=docker` ogni passo gira in un container usa-e-getta: `--network none`, root fs read-only, `--cap-drop ALL`, `no-new-privileges`, limiti di memoria/pids/CPU/ulimit. Per gdb viene aggiunto solo `SYS_PTRACE`.

## Configurazione del compilatore (variabili d’ambiente del backend)

| Variabile | Default | Significato |
|---|---|---|
| `CSTUDIO_PORT` / `CSTUDIO_HOST` | 8787 / 0.0.0.0 | ascolto HTTP/WS |
| `CSTUDIO_ORIGINS` | `*` | origini browser ammesse (separate da virgola) — impostarle in produzione |
| `CSTUDIO_SANDBOX` | `native` | `native` (namespace Linux) o `docker` |
| `CSTUDIO_DOCKER_IMAGE` | `cstudio-sandbox:latest` | immagine per il driver docker |
| `CSTUDIO_WORK_ROOT` | `/tmp/cstudio-jobs` | directory temporanee dei job (eliminate a fine job) |
| `CSTUDIO_RUN_CPU_S` | 5 | secondi di CPU per programma |
| `CSTUDIO_RUN_WALL_MS` / `_MAX_MS` | 60000 / 300000 | tempo reale predefinito / massimo |
| `CSTUDIO_MEMORY_BYTES` | 256 MiB | memoria (RLIMIT_AS) |
| `CSTUDIO_MAX_PROCS` | 32 | processi per job |
| `CSTUDIO_MAX_OUTPUT` | 1 MiB | output massimo |
| `CSTUDIO_COMPILE_TIMEOUT_MS` | 20000 | timeout di ogni passo di compilazione |
| `CSTUDIO_CONCURRENT_JOBS` | 4 | job simultanei (ognuno con uid dedicato) |
| `CSTUDIO_RPM` | 120 | richieste/minuto per IP |
| `CSTUDIO_STATIC` | — | se impostata, serve il frontend compilato |

Nel frontend: *Impostazioni → Compilatore* (URL del backend, compilatore, standard C11/C17/C23, ottimizzazione, warning, `-Werror`, UBSan, `-lm`/`-lpthread`, macro, flag personalizzati validati da allow-list, timeout, argomenti del programma). Configurazione Debug predefinita = `gcc -std=c17 -Wall -Wextra -O0 -g`.

## Architettura

```
Browser (React + TypeScript + Monaco, PWA)            Backend (Node + TypeScript, ws)
 ├─ stores (zustand): app, build, run, debug           ├─ api/routes.ts      GET /api/health, POST /api/compile, /api/format
 ├─ IndexedDB: progetti, bozze, VCS, impostazioni ──┐  ├─ execution/runSession.ts   WS /ws/run  (stdin/stdout in streaming)
 ├─ editor/monaco.ts: IntelliSense C, markers       │  ├─ debugger/gdbSession.ts    WS /ws/debug (GDB/MI + FIFO per l’I/O)
 ├─ service worker: shell offline                   │  ├─ compiler/compile.ts       .c → .o separati, poi link
 └─ HTTP /api  +  WebSocket /ws ────────────────────┴─►└─ security/ sandbox.ts (native|docker), workspace.ts (uid per job),
                                                          validation.ts (path + allow-list flag), rateLimit.ts
```

Il codice utente **non viene mai eseguito nel processo del server**: compilatore, programma e gdb girano in un processo isolato con rete disabilitata, namespace PID/IPC/UTS/mount propri, `/root /home /var /opt /srv /tmp` nascosti, uid non privilegiato dedicato al job, `no_new_privs`, limiti `prlimit` (AS, CPU, NPROC, FSIZE, NOFILE, core=0), timeout reale, limite di output e directory temporanea eliminata a fine job.

## Struttura dei file

```
src/
  app/            App.tsx (routing schermate, error boundary, lazy loading), persistence.ts (bozze, auto-save, sessione)
  components/     common/ toolbar/ sidebar/ editor/ panels/ statusbar/ dialogs/ screens/ Workbench.tsx
  editor/         monaco.ts, editorRegistry.ts, symbols.ts (indicizzatore C), cStdlib.ts (documentazione), snippets.ts
  features/       projects/ compiler/ execution/ debugger/ search/ vcs/ terminal/ settings/ extensions/ ai/ commands/
  hooks/ services/ stores/ styles/ types/ utils/
public/           manifest.webmanifest, sw.js, icons/
backend/src/      api/ compiler/ execution/ debugger/ security/ services/ server.ts config.ts types.ts
backend/sandbox/  Dockerfile dell’immagine sandbox
e2e/run.mjs       test end-to-end in Chrome reale
```

## Funzionalità realmente implementate

- **Progetti**: 8 template (Empty, Console, Hello World, Calculator, Multi-file, Data Structures, Algorithms, Custom), esempi, progetti recenti, apri/rinomina/duplica/elimina, import ZIP / cartella / file singoli, export ZIP (con `.cstudio/config.json`), backup e ripristino completi, salvataggio automatico o manuale, **recupero delle modifiche non salvate** e della sessione (schede, layout, cartelle aperte). “Apri cartella” collega una cartella reale (File System Access API, Chrome/Edge) e riscrive i file al salvataggio; su Safari/Firefox fallback a importazione.
- **Explorer**: albero, nuovo file/cartella, rinomina, duplica, copia/taglia/incolla, sposta, elimina, scarica, copia percorso, menu contestuale (tasto destro, pressione prolungata o “⋯”), drag & drop su desktop, indicatori di file non salvati ed errori.
- **Editor Monaco**: syntax highlighting C, schede multiple con icona/indicatore/chiusura e conferma su file non salvati, split verticale/orizzontale (spostamento schede tra editor), minimap, word wrap, folding, guide, multi-cursore, trova/sostituisci, commenti, vai a riga/parentesi, sticky scroll, font e dimensione, 4 schemi di colori.
- **IntelliSense**: funzioni standard con firma e documentazione, header `#include <…>`/`"…"`, simboli del progetto (funzioni, macro, typedef, struct/enum, globali) e variabili locali/parametri nello scope corrente, signature help, hover, vai alla definizione anche tra file, trova riferimenti, outline (file e progetto), snippet integrati e personalizzati.
- **Compilazione reale**: GCC 13 / Clang 18, C89–C23, ogni `.c` compilato in oggetto e poi linkato, include automatici, diagnostica strutturata (file:riga:colonna, errori/warning/note, errori di linker), marker nell’editor, pannello Problems cliccabile, Output con comandi, stderr, durata e dimensione dell’eseguibile, diagnostica automatica dopo ogni salvataggio, formattazione clang-format.
- **Esecuzione**: “Compila ed esegui”, “Esegui ultima build”, input interattivo reale (stdin in streaming, EOF), stop, tempo di esecuzione, codice di uscita, segnali spiegati (SIGFPE, SIGSEGV…), timeout, limite output, argomenti del programma.
- **Debugger GDB reale**: breakpoint (margine, F9; verificati da gdb), continue, step over/into/out, pausa, stop, riavvio, call stack con selezione frame, variabili locali, watch, valutazione espressioni, registri, riga corrente evidenziata, input del programma durante il debug.
- **Terminale**: shell integrata sui file reali del progetto (`ls cd pwd cat head tail wc grep touch mkdir rm mv cp echo > >> tree open format history clear`), `gcc/cc/clang` col compilatore reale, `./app` con I/O interattivo, cronologia e completamento con Tab.
- **Ricerca globale** (testo, regex, maiuscole, parola intera, filtri include/exclude, sostituzione singola o totale), **command palette** (file e comandi), scorciatoie da tastiera.
- **Controllo versione locale**: init, commit, modifiche (A/M/D), diff (affiancato/in linea), annulla modifiche, cronologia, ripristino versione, branch.
- **Interfaccia**: tema scuro/chiaro/OLED, colori personalizzabili, densità (compatta/comoda/touch/automatica), layout distinti per desktop, tablet orizzontale, tablet verticale (cassetto), smartphone (navigazione inferiore, pannelli a schermo intero), barra simboli C per tablet personalizzabile che resta sopra la tastiera virtuale, pannello ridimensionabile/massimizzabile, toast, dialoghi, stati vuoti/errore, impostazioni complete (Aspetto, Editor, Compilatore, Tastiera, Workspace, Privacy e sicurezza), documentazione C con guide.
- **Compilatore nel browser**: Clang reale in WebAssembly (compilazione separata dei .c e link), esecuzione in Web Worker con stdout/stderr in streaming, input interattivo, stop, timeout, limite di output, file del progetto accessibili con `fopen`, trap mappate sui segnali; usato anche dal terminale.
- **PWA**: manifest, icone, service worker che precarica tutti gli asset e mette in cache il compilatore WebAssembly; offline funzionano editor, progetti, ricerca, VCS, terminale e — dopo il primo download — compilazione ed esecuzione nel browser. Debug e formattazione offline vengono mostrati come non disponibili con il motivo.

## Funzionalità non ancora complete (dichiarate, non simulate)

- **Git vero** (repository `.git`, push/pull remoti): non implementato; c’è un controllo versione locale snapshot-based.
- **AI Assistant**: solo architettura (`src/features/ai/assistant.ts`); nell’interfaccia è disabilitato con spiegazione.
- **Estensioni esterne**: definiti manifest/API; si possono attivare/disattivare solo le estensioni integrate.
- **IntelliSense** basato su indicizzatore proprio (non clangd): niente completamento dei membri `s.campo`/`p->campo`, niente analisi semantica completa.
- **Debugger**: niente breakpoint condizionali né espansione ad albero di struct/array (mostrati come valore testuale); in debug gli argomenti del programma accettano solo caratteri semplici e non si può inviare EOF.
- **Sandbox native**: `/usr` ed `/etc` restano leggibili (sola lettura); per ambienti multi-utente usare il driver **docker** (non verificato in questo ambiente perché il daemon Docker non era disponibile).
- **Account e sincronizzazione cloud**: non previsti (nessun database backend); la “sincronizzazione” è la riscrittura su cartella collegata.
- Test su **dispositivi reali** (iPad Safari, Android) non eseguiti: il responsive è verificato con emulazione touch in Chrome.

## Test

```bash
npm test                    # unit (vitest): indicizzatore C, ricerca, VCS, shell, ZIP, path — 12 test
sudo npm run test:backend   # integrazione backend con GCC reale — 14 test
npm run build && sudo node e2e/run.mjs   # end-to-end in Chrome reale con server — 23 verifiche
npx vite build --base /cstudio/ && node e2e/browser-engine.mjs   # end-to-end senza server (compilatore nel browser) — 10 verifiche
```

Risultati dell’ultima esecuzione: **12/12 unit, 14/14 backend, 23/23 end-to-end con server, 10/10 end-to-end senza server** (i tre programmi di prova passano con entrambi i motori), incluso:
- Test 1 *Hello World*: compilato ed eseguito, output `Hello, World!`, codice 0.
- Test 2 *somma*: prompt visibile prima di `scanf`, input `17 25` → `Somma: 42`.
- Test 3 *divisione per zero*: compila (eventuale warning), **non** è un errore di compilazione; a runtime viene segnalato `SIGFPE`.
- Isolamento: rete bloccata, `/home` vuota, scrittura su `/usr` negata, uid ≠ 0, fork bomb contenuta, ciclo infinito fermato, flag pericolosi (`-fplugin`, `@file`) e path traversal rifiutati.
