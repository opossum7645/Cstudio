/**
 * Integrated terminal: a small POSIX-like shell over the project's virtual file system.
 * File commands operate on the real project files; gcc/cc/clang call the real compiler
 * service; ./app and `run` execute the program with real, interactive stdin/stdout.
 * There is no access to a host shell: commands not listed in `help` are rejected.
 */
import { basename, isWithin, join, normalize } from '../../utils/path';

export interface ShellFs {
  files(): Record<string, string>;
  folders(): string[];
  write(path: string, content: string): Promise<boolean>;
  mkdir(path: string): Promise<boolean>;
  remove(path: string): Promise<boolean>;
  move(from: string, to: string): Promise<boolean>;
}

export interface ShellHost {
  fs: ShellFs;
  print(text: string, kind?: 'out' | 'err' | 'info'): void;
  clear(): void;
  open(path: string): void;
  /** compile with explicit sources & flags; returns success */
  compile(sources: string[], flags: string[]): Promise<boolean>;
  /** run the last successful terminal build interactively; resolves when the program exits */
  run(args: string[]): Promise<void>;
  format(path: string): Promise<boolean>;
}

const HELP: [string, string][] = [
  ['help', 'mostra questo elenco'],
  ['ls [-l] [dir]', 'elenca file e cartelle'],
  ['cd <dir>', 'cambia cartella (cd .. / cd /)'],
  ['pwd', 'cartella corrente'],
  ['cat <file>', 'mostra il contenuto di un file'],
  ['head|tail [-n N] <file>', 'prime/ultime righe'],
  ['wc <file>', 'conta righe, parole, caratteri'],
  ['grep [-n] [-i] <testo> <file…>', 'cerca testo nei file'],
  ['touch <file>', 'crea un file vuoto'],
  ['mkdir <dir>', 'crea una cartella'],
  ['rm [-r] <path>', 'elimina file o cartelle'],
  ['mv <src> <dst>', 'sposta/rinomina'],
  ['cp <src> <dst>', 'copia un file'],
  ['echo <testo> [> file | >> file]', 'stampa o scrive su file'],
  ['open <file>', 'apre il file nell’editor'],
  ['gcc|cc|clang [flag] <file.c…>', 'compila con il compilatore reale (sandbox)'],
  ['./app [argomenti] | run', 'esegue l’ultimo programma compilato dal terminale'],
  ['format <file>', 'formatta con clang-format'],
  ['tree [dir]', 'albero delle cartelle'],
  ['history', 'cronologia comandi'],
  ['clear', 'pulisce il terminale'],
];

/** Shell-like tokenizer with quotes and redirections. */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < line.length) cur += line[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (c === ' ' || c === '\t') {
      if (cur || has) out.push(cur);
      cur = '';
      has = false;
    } else if (c === '>') {
      if (cur || has) out.push(cur);
      cur = '';
      has = false;
      if (line[i + 1] === '>') {
        out.push('>>');
        i++;
      } else out.push('>');
    } else cur += c;
  }
  if (quote) throw new Error('virgolette non chiuse');
  if (cur || has) out.push(cur);
  return out;
}

export class Shell {
  cwd = '';
  history: string[] = [];
  private lastBuildOk = false;

  constructor(private host: ShellHost) {}

  get prompt(): string {
    return this.cwd ? `~/${this.cwd}$ ` : '~$ ';
  }

  private resolve(p: string): string {
    if (p === '/' || p === '~') return '';
    if (p.startsWith('/') || p.startsWith('~/')) return normalize(p.replace(/^~?\//, ''));
    return normalize(`${this.cwd}/${p}`);
  }

  private isDir(p: string): boolean {
    return p === '' || this.host.fs.folders().includes(p) || Object.keys(this.host.fs.files()).some((f) => isWithin(f, p) && f !== p);
  }

  private isFile(p: string): boolean {
    return p in this.host.fs.files();
  }

  private children(dir: string): { name: string; dir: boolean; size: number }[] {
    const names = new Map<string, { name: string; dir: boolean; size: number }>();
    const files = this.host.fs.files();
    for (const f of [...Object.keys(files), ...this.host.fs.folders()]) {
      if (!isWithin(f, dir) || f === dir) continue;
      const rest = dir ? f.slice(dir.length + 1) : f;
      const first = rest.split('/')[0]!;
      const isDir = rest.includes('/') || !(f in files);
      if (!names.has(first)) names.set(first, { name: first, dir: isDir, size: isDir ? 0 : files[f]!.length });
    }
    return [...names.values()].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  }

  complete(partial: string): string[] {
    const toks = partial.split(' ');
    const last = toks[toks.length - 1] ?? '';
    const dirPart = last.includes('/') ? last.slice(0, last.lastIndexOf('/') + 1) : '';
    const base = this.resolve(dirPart || '.');
    const prefix = last.slice(dirPart.length);
    return this.children(base).filter((c) => c.name.startsWith(prefix)).map((c) => dirPart + c.name + (c.dir ? '/' : ''));
  }

  async execute(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;
    this.history.push(trimmed);
    if (this.history.length > 500) this.history.shift();
    let args: string[];
    try {
      args = tokenize(trimmed);
    } catch (e) {
      this.host.print(`sh: ${(e as Error).message}\n`, 'err');
      return;
    }
    // output redirection (echo only, plus any command output for simplicity)
    let redirect: { path: string; append: boolean } | null = null;
    const ri = args.findIndex((a) => a === '>' || a === '>>');
    if (ri >= 0) {
      const target = args[ri + 1];
      if (!target) return this.host.print('sh: manca il file di destinazione\n', 'err');
      redirect = { path: this.resolve(target), append: args[ri] === '>>' };
      args = args.slice(0, ri);
    }
    const [cmd, ...rest] = args;
    let captured = '';
    const out = (t: string) => (redirect ? (captured += t) : this.host.print(t));
    const err = (t: string) => this.host.print(t, 'err');
    const files = () => this.host.fs.files();
    const flags = rest.filter((a) => /^-[a-zA-Z]+$/.test(a));
    const operands = rest.filter((a) => !/^-[a-zA-Z]+$/.test(a));

    switch (cmd) {
      case 'help':
        out('Comandi disponibili:\n' + HELP.map(([c, d]) => `  ${c.padEnd(34)} ${d}`).join('\n') + '\n');
        break;
      case 'clear':
        this.host.clear();
        break;
      case 'pwd':
        out(`/${this.cwd}\n`);
        break;
      case 'history':
        out(this.history.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join('\n') + '\n');
        break;
      case 'cd': {
        const target = this.resolve(operands[0] ?? '/');
        if (!this.isDir(target)) return err(`cd: ${operands[0]}: cartella inesistente\n`);
        this.cwd = target;
        break;
      }
      case 'ls': {
        const target = this.resolve(operands[0] ?? '.');
        if (this.isFile(target)) {
          out(basename(target) + '\n');
          break;
        }
        if (!this.isDir(target)) return err(`ls: ${operands[0]}: non trovato\n`);
        const items = this.children(target);
        if (flags.some((f) => f.includes('l'))) out(items.map((c) => `${c.dir ? 'd' : '-'}rw-r--r--  ${String(c.size).padStart(7)}  ${c.name}${c.dir ? '/' : ''}`).join('\n') + (items.length ? '\n' : ''));
        else out(items.map((c) => c.name + (c.dir ? '/' : '')).join('  ') + (items.length ? '\n' : ''));
        break;
      }
      case 'tree': {
        const root = this.resolve(operands[0] ?? '.');
        const walk = (d: string, pre: string) => {
          const ch = this.children(d);
          ch.forEach((c, i) => {
            const lastItem = i === ch.length - 1;
            out(`${pre}${lastItem ? '└── ' : '├── '}${c.name}${c.dir ? '/' : ''}\n`);
            if (c.dir) walk(join(d, c.name), pre + (lastItem ? '    ' : '│   '));
          });
        };
        out(`${root || '.'}\n`);
        walk(root, '');
        break;
      }
      case 'cat': {
        if (!operands.length) return err('cat: specifica un file\n');
        for (const o of operands) {
          const p = this.resolve(o);
          if (!this.isFile(p)) return err(`cat: ${o}: file inesistente\n`);
          const c = files()[p]!;
          out(c.endsWith('\n') || !c ? c : c + '\n');
        }
        break;
      }
      case 'head':
      case 'tail': {
        let n = 10;
        const ni = rest.indexOf('-n');
        if (ni >= 0) n = Math.max(0, Number(rest[ni + 1]) || 10);
        const fileArg = rest.filter((a, i) => a !== '-n' && rest[i - 1] !== '-n')[0];
        const p = fileArg ? this.resolve(fileArg) : '';
        if (!fileArg || !this.isFile(p)) return err(`${cmd}: file non valido\n`);
        const lines = files()[p]!.split('\n');
        if (lines[lines.length - 1] === '') lines.pop();
        out((cmd === 'head' ? lines.slice(0, n) : lines.slice(-n)).join('\n') + '\n');
        break;
      }
      case 'wc': {
        for (const o of operands) {
          const p = this.resolve(o);
          if (!this.isFile(p)) return err(`wc: ${o}: file inesistente\n`);
          const c = files()[p]!;
          out(`${String(c.split('\n').length - (c.endsWith('\n') ? 1 : 0)).padStart(6)} ${String(c.split(/\s+/).filter(Boolean).length).padStart(6)} ${String(c.length).padStart(7)} ${o}\n`);
        }
        break;
      }
      case 'grep': {
        const [pattern, ...targets] = operands;
        if (!pattern) return err('grep: specifica un testo\n');
        const ci = flags.some((f) => f.includes('i'));
        const num = flags.some((f) => f.includes('n'));
        const paths = targets.length ? targets.map((t) => this.resolve(t)) : Object.keys(files()).filter((f) => isWithin(f, this.cwd));
        const needle = ci ? pattern.toLowerCase() : pattern;
        for (const p of paths) {
          if (!this.isFile(p)) continue;
          files()[p]!.split('\n').forEach((l, i) => {
            if ((ci ? l.toLowerCase() : l).includes(needle)) out(`${paths.length > 1 || !targets.length ? p + ':' : ''}${num ? i + 1 + ':' : ''}${l}\n`);
          });
        }
        break;
      }
      case 'touch':
        for (const o of operands) {
          const p = this.resolve(o);
          if (!this.isFile(p)) await this.host.fs.write(p, '');
        }
        break;
      case 'mkdir':
        for (const o of operands) await this.host.fs.mkdir(this.resolve(o));
        break;
      case 'rm': {
        if (!operands.length) return err('rm: specifica un percorso\n');
        const recursive = flags.some((f) => f.includes('r'));
        for (const o of operands) {
          const p = this.resolve(o);
          if (this.isFile(p)) await this.host.fs.remove(p);
          else if (this.isDir(p) && p !== '') {
            if (!recursive) err(`rm: ${o}: è una cartella (usa -r)\n`);
            else await this.host.fs.remove(p);
          } else err(`rm: ${o}: non trovato\n`);
        }
        break;
      }
      case 'mv':
      case 'cp': {
        if (operands.length !== 2) return err(`${cmd}: uso: ${cmd} <sorgente> <destinazione>\n`);
        const src = this.resolve(operands[0]!);
        let dst = this.resolve(operands[1]!);
        if (this.isDir(dst)) dst = join(dst, basename(src));
        if (cmd === 'mv') {
          if (!this.isFile(src) && !this.isDir(src)) return err(`mv: ${operands[0]}: non trovato\n`);
          await this.host.fs.move(src, dst);
        } else {
          if (!this.isFile(src)) return err(`cp: ${operands[0]}: copia di cartelle non supportata\n`);
          await this.host.fs.write(dst, files()[src]!);
        }
        break;
      }
      case 'echo':
        out(rest.join(' ') + '\n');
        break;
      case 'open': {
        const p = this.resolve(operands[0] ?? '');
        if (!this.isFile(p)) return err('open: file inesistente\n');
        this.host.open(p);
        break;
      }
      case 'format': {
        const p = this.resolve(operands[0] ?? '');
        if (!this.isFile(p)) return err('format: file inesistente\n');
        if (await this.host.format(p)) out(`${p} formattato\n`);
        break;
      }
      case 'gcc':
      case 'cc':
      case 'clang': {
        const sources = operands.filter((o) => o.endsWith('.c')).map((o) => this.resolve(o));
        const missing = sources.filter((s) => !this.isFile(s));
        if (missing.length) return err(`${cmd}: ${missing.join(', ')}: file inesistente\n`);
        if (!sources.length) return err(`${cmd}: nessun file sorgente .c\n`);
        const passFlags = rest.filter((a, i) => a.startsWith('-') && a !== '-o' && rest[i - 1] !== '-o');
        if (cmd === 'clang') passFlags.push('--clang');
        this.lastBuildOk = await this.host.compile(sources, passFlags);
        break;
      }
      case 'run':
        if (!this.lastBuildOk) return err('run: nessun programma compilato dal terminale. Esempio: gcc src/main.c\n');
        await this.host.run(rest);
        break;
      default:
        if (cmd && /^\.\/(app|a\.out|build\/app)$/.test(cmd)) {
          if (!this.lastBuildOk) return err(`sh: ${cmd}: nessun programma compilato (usa prima gcc)\n`);
          await this.host.run(rest);
          break;
        }
        err(`sh: ${cmd}: comando non disponibile. Digita "help" per l’elenco.\n`);
    }
    if (redirect) {
      const existing = this.isFile(redirect.path) ? files()[redirect.path]! : '';
      await this.host.fs.write(redirect.path, redirect.append ? existing + captured : captured);
    }
  }
}
