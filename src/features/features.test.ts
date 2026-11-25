import { describe, it, expect } from 'vitest';
import { searchFiles, replaceInText } from './search/search';
import { initRepo, commit, status, history, createBranch, switchBranch } from './vcs/vcs';
import { Shell, ShellHost, tokenize } from './terminal/shell';
import { exportProjectZip, importProjectZip } from './projects/zip';
import { newProjectFromTemplate } from './projects/projectRepo';
import { TEMPLATES, defaultDebugConfig } from './projects/templates';
import { normalize, uniqueName, validateName, globToRegExp } from '../utils/path';

describe('path utils', () => {
  it('normalizes and validates', () => {
    expect(normalize('./src/../include//a.h')).toBe('include/a.h');
    expect(validateName('ok_name.c')).toBeNull();
    expect(validateName('bad/name')).not.toBeNull();
    expect(uniqueName('src/main.c', (p) => p === 'src/main.c')).toBe('src/main copia.c');
    expect(globToRegExp('*.c').test('src/main.c')).toBe(true);
  });
});

describe('search', () => {
  const files = { 'a.c': 'int x = 1;\nint y = x + 1;\n', 'b.h': 'extern int x;\n' };
  it('finds plain, whole-word, regex and filtered matches', () => {
    expect(searchFiles(files, { query: 'x', regex: false, caseSensitive: true, wholeWord: true, include: '', exclude: '' }).total).toBe(3);
    expect(searchFiles(files, { query: 'x', regex: false, caseSensitive: true, wholeWord: true, include: '*.h', exclude: '' }).total).toBe(1);
    const r = searchFiles(files, { query: 'int (\\w)', regex: true, caseSensitive: true, wholeWord: false, include: '', exclude: '' });
    expect(r.results[0]!.matches[1]!.line).toBe(2);
    expect(searchFiles(files, { query: '(', regex: true, caseSensitive: false, wholeWord: false, include: '', exclude: '' }).error).toMatch(/non valida/);
  });
  it('replaces with groups', () => {
    const o = { query: 'int (\\w)', regex: true, caseSensitive: true, wholeWord: false, include: '', exclude: '' };
    expect(replaceInText(files['a.c'], o, 'long $1').text).toBe('long x = 1;\nlong y = x + 1;\n');
  });
});

describe('local version control', () => {
  it('commits, reports status, branches and restores', () => {
    let repo = initRepo();
    repo = commit(repo, { 'a.c': '1' }, 'first');
    expect(status(repo, { 'a.c': '2', 'b.c': '' })).toEqual([{ path: 'a.c', kind: 'modified' }, { path: 'b.c', kind: 'added' }]);
    expect(() => commit(repo, { 'a.c': '1' }, 'noop')).toThrow();
    repo = createBranch(repo, 'feat');
    repo = commit(repo, { 'a.c': '2' }, 'second');
    expect(history(repo).map((c) => c.message)).toEqual(['second', 'first']);
    const sw = switchBranch(repo, 'main');
    expect(sw.files).toEqual({ 'a.c': '1' });
  });
});

describe('terminal shell', () => {
  function host() {
    const files: Record<string, string> = { 'src/main.c': 'int main(void){return 0;}\n' };
    const folders = ['src'];
    let out = '';
    const compiled: string[][] = [];
    const h: ShellHost = {
      fs: {
        files: () => files, folders: () => folders,
        write: async (p, c) => ((files[p] = c), true),
        mkdir: async (p) => (folders.push(p), true),
        remove: async (p) => (delete files[p], true),
        move: async (a, b) => ((files[b] = files[a]!), delete files[a], true),
      },
      print: (t) => (out += t), clear: () => (out = ''), open: () => undefined,
      compile: async (s, f) => (compiled.push([...s, ...f]), true), run: async () => { out += '[run]'; }, format: async () => true,
    };
    return { h, files, get out() { return out; }, compiled };
  }
  it('tokenizes quotes and redirections', () => {
    expect(tokenize('echo "a b" > f.txt')).toEqual(['echo', 'a b', '>', 'f.txt']);
  });
  it('runs file commands, redirection, gcc and ./app', async () => {
    const t = host();
    const sh = new Shell(t.h);
    await sh.execute('cd src');
    await sh.execute('echo hello > note.txt');
    expect(t.files['src/note.txt']).toBe('hello\n');
    await sh.execute('ls');
    expect(t.out).toContain('main.c');
    await sh.execute('./app');
    expect(t.out).toContain('nessun programma');
    await sh.execute('gcc -Wall main.c');
    expect(t.compiled[0]).toEqual(['src/main.c', '-Wall']);
    await sh.execute('./app');
    expect(t.out).toContain('[run]');
    await sh.execute('rm-rf /');
    expect(t.out).toContain('comando non disponibile');
  });
});

describe('projects & zip', () => {
  it('round-trips a project through ZIP export/import', async () => {
    const tpl = TEMPLATES.find((t) => t.id === 'multifile')!;
    const p = newProjectFromTemplate({ name: 'demo', template: tpl, std: 'c11', config: 'release', base: defaultDebugConfig });
    expect(p.folders).toEqual(expect.arrayContaining(['src', 'include', 'build']));
    const blob = await exportProjectZip(p);
    const { project } = await importProjectZip(blob, 'x');
    expect(project.name).toBe('demo');
    expect(Object.keys(project.files).sort()).toEqual(Object.keys(p.files).sort());
    expect(project.buildConfigs.debug.std).toBe('c11');
    expect(project.activeConfig).toBe('release');
  });
});
