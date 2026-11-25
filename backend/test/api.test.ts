/**
 * Integration tests against a real backend process and the real compiler.
 * Run as root (native sandbox needs namespaces): npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { startServer, session, stdout, exitMsg, BASE, Msg } from './helpers.js';

let server: ChildProcess;
before(async () => {
  server = await startServer();
});
after(() => {
  server.kill('SIGTERM');
});

const HELLO = `#include <stdio.h>

int main(void) {
    printf("Hello, World!\\n");
    return 0;
}
`;
const SUM = `#include <stdio.h>

int main(void) {
    int a, b;
    printf("Inserisci due numeri: ");
    scanf("%d %d", &a, &b);
    printf("Somma: %d\\n", a + b);
    return 0;
}
`;
const DIVZERO = `#include <stdio.h>

int main(void) {
    int x = 10;
    int y = 0;
    printf("%d\\n", x / y);
    return 0;
}
`;
const cfg = { compiler: 'gcc', std: 'c17', optimization: 'O0', warnings: { all: true, extra: true } };

test('health reports a working sandbox and gcc', async () => {
  const h = (await (await fetch(`${BASE}/api/health`)).json()) as { ok: boolean; toolchain: { gcc: { available: boolean } } };
  assert.equal(h.ok, true);
  assert.equal(h.toolchain.gcc.available, true);
});

test('Test 1: Hello World compiles and runs', async () => {
  const msgs = await session('/ws/run', { files: [{ path: 'src/main.c', content: HELLO }], config: cfg });
  const compile = msgs.find((m) => m.type === 'compile') as Msg & { result: { success: boolean } };
  assert.equal(compile.result.success, true);
  assert.equal(stdout(msgs), 'Hello, World!\n');
  assert.equal(exitMsg(msgs).exitCode, 0);
});

test('Test 2: interactive input produces the sum', async () => {
  let sent = false;
  const msgs = await session('/ws/run', { files: [{ path: 'main.c', content: SUM }], config: cfg }, (m, ws) => {
    if (m.type === 'stdout' && String(m.data).includes('Inserisci') && !sent) {
      sent = true;
      ws.send(JSON.stringify({ type: 'stdin', data: '17 25\n' }));
    }
  });
  assert.ok(sent, 'prompt was shown before input (unbuffered stdout)');
  assert.equal(stdout(msgs), 'Inserisci due numeri: Somma: 42\n');
  assert.equal(exitMsg(msgs).exitCode, 0);
});

test('Test 3: division by zero compiles (maybe with warning) and fails at runtime with SIGFPE', async () => {
  const msgs = await session('/ws/run', { files: [{ path: 'main.c', content: DIVZERO }], config: cfg });
  const compile = msgs.find((m) => m.type === 'compile') as Msg & { result: { success: boolean; diagnostics: { severity: string }[] } };
  assert.equal(compile.result.success, true, 'must not be reported as a compile error');
  assert.ok(compile.result.diagnostics.every((d) => d.severity !== 'error'));
  const exit = exitMsg(msgs);
  assert.equal(exit.reason, 'signal');
  assert.equal(exit.signal, 'SIGFPE');
});

test('compile errors are parsed with file/line/column', async () => {
  const r = await fetch(`${BASE}/api/compile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: [{ path: 'src/main.c', content: 'int main(void) {\n  int x = ;\n  return y;\n}\n' }], config: cfg }),
  });
  const res = (await r.json()) as { success: boolean; diagnostics: { file: string; line: number; column: number; severity: string }[] };
  assert.equal(res.success, false);
  const errs = res.diagnostics.filter((d) => d.severity === 'error');
  assert.ok(errs.length >= 2);
  assert.equal(errs[0]!.file, 'src/main.c');
  assert.equal(errs[0]!.line, 2);
  assert.ok(errs[0]!.column > 1);
});

test('multi-file project with headers links correctly; missing symbol is a linker error', async () => {
  const files = [
    { path: 'include/functions.h', content: '#ifndef F_H\n#define F_H\nint add(int a, int b);\nint mul(int a, int b);\n#endif\n' },
    { path: 'src/functions.c', content: '#include "functions.h"\nint add(int a, int b) { return a + b; }\n' },
    { path: 'src/main.c', content: '#include <stdio.h>\n#include "functions.h"\nint main(void) { printf("%d\\n", add(2, 3)); return 0; }\n' },
  ];
  const ok = await session('/ws/run', { files, config: cfg });
  assert.equal(stdout(ok), '5\n');
  files[2]!.content = '#include "functions.h"\nint main(void) { return mul(2, 3); }\n';
  const r = await fetch(`${BASE}/api/compile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files, config: cfg }) });
  const res = (await r.json()) as { success: boolean; diagnostics: { source: string; message: string }[] };
  assert.equal(res.success, false);
  assert.ok(res.diagnostics.some((d) => d.source === 'linker' && d.message.includes('mul')));
});

test('libm can be linked when allowed', async () => {
  const src = '#include <stdio.h>\n#include <math.h>\nint main(void){ volatile double x = 2.0; printf("%.3f\\n", sqrt(x)); return 0; }\n';
  const msgs = await session('/ws/run', { files: [{ path: 'main.c', content: src }], config: { ...cfg, libraries: ['m'] } });
  assert.equal(stdout(msgs), '1.414\n');
});

test('infinite loop is stopped by the timeout / CPU limit', async () => {
  const msgs = await session('/ws/run', { files: [{ path: 'main.c', content: 'int main(void){ for(;;){} }\n' }], config: cfg, wallTimeoutMs: 3000 });
  const exit = exitMsg(msgs);
  assert.ok(exit.reason === 'timeout' || exit.signal === 'SIGKILL' || exit.signal === 'SIGXCPU', JSON.stringify(exit));
});

test('isolation: no network, hidden home directories, cannot write outside job dir', async () => {
  const src = `#include <stdio.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <dirent.h>
int main(void) {
  int s = socket(AF_INET, SOCK_STREAM, 0);
  struct sockaddr_in a = {0}; a.sin_family = AF_INET; a.sin_port = htons(80); inet_pton(AF_INET, "1.1.1.1", &a.sin_addr);
  printf("net=%s\\n", connect(s, (struct sockaddr*)&a, sizeof a) == 0 ? "OPEN" : "blocked");
  DIR *d = opendir("/home"); int n = 0; struct dirent *e;
  while (d && (e = readdir(d))) if (e->d_name[0] != '.') n++;
  printf("home_entries=%d\\n", n);
  FILE *f = fopen("/usr/cstudio_pwned", "w");
  printf("write_usr=%s\\n", f ? "OPEN" : "blocked");
  printf("uid=%d\\n", (int)getuid());
  return 0;
}
`;
  const msgs = await session('/ws/run', { files: [{ path: 'main.c', content: src }], config: { ...cfg, std: 'gnu17' } });
  const out = stdout(msgs);
  assert.match(out, /net=blocked/);
  assert.match(out, /home_entries=0/);
  assert.match(out, /write_usr=blocked/);
  assert.doesNotMatch(out, /uid=0\b/);
});

test('fork bomb is contained by the process limit', async () => {
  const src = '#include <unistd.h>\n#include <stdio.h>\n#include <sys/types.h>\nint main(void){ int ok=0; for(int i=0;i<500;i++){ pid_t p=fork(); if(p==0){ sleep(2); _exit(0);} else if(p>0) ok++; } printf("%d\\n", ok); return 0; }\n';
  const msgs = await session('/ws/run', { files: [{ path: 'main.c', content: src }], config: cfg });
  const n = Number(stdout(msgs).trim().split('\n').pop());
  assert.ok(n < 100, `forks created: ${n}`);
});

test('dangerous flags and paths are rejected', async () => {
  const bad = async (body: unknown) => (await fetch(`${BASE}/api/compile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status;
  assert.equal(await bad({ files: [{ path: 'main.c', content: 'int main(void){return 0;}' }], config: { extraFlags: ['-fplugin=/tmp/x.so'] } }), 400);
  assert.equal(await bad({ files: [{ path: 'main.c', content: 'int main(void){return 0;}' }], config: { extraFlags: ['@/etc/passwd'] } }), 400);
  assert.equal(await bad({ files: [{ path: '../evil.c', content: '' }] }), 400);
  assert.equal(await bad({ files: [{ path: '/etc/evil.c', content: '' }] }), 400);
});

test('clang compiles too, and c23 standard is accepted', async () => {
  const msgs = await session('/ws/run', { files: [{ path: 'main.c', content: HELLO }], config: { ...cfg, compiler: 'clang', std: 'c23' } });
  assert.equal(stdout(msgs), 'Hello, World!\n');
});

test('format endpoint runs clang-format', async () => {
  const r = await fetch(`${BASE}/api/format`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'int main(void){return 0;}', options: { indentWidth: 4 } }) });
  const res = (await r.json()) as { code: string };
  assert.equal(res.code.trim(), 'int main(void) { return 0; }');
});

test('debugger: breakpoint, locals, step, input, exit', async () => {
  const src = `#include <stdio.h>

int square(int v) {
    int r = v * v;
    return r;
}

int main(void) {
    int a = 0;
    scanf("%d", &a);
    int b = square(a);
    printf("result=%d\\n", b);
    return 0;
}
`;
  const states: Msg[] = [];
  let step = 0;
  const msgs = await session('/ws/debug', { files: [{ path: 'src/main.c', content: src }], config: cfg, breakpoints: [{ file: 'src/main.c', line: 11 }], watches: ['a * 2'] }, (m, ws) => {
    if (m.type === 'phase' && m.phase === 'running') ws.send(JSON.stringify({ type: 'stdin', data: '7\n' }));
    if (m.type === 'state' && m.state === 'stopped') {
      states.push(m);
      step++;
      if (step === 1) ws.send(JSON.stringify({ type: 'command', command: 'step' }));
      else if (step === 2) ws.send(JSON.stringify({ type: 'command', command: 'finish' }));
      else ws.send(JSON.stringify({ type: 'command', command: 'continue' }));
    }
  }, 30_000);
  const first = states[0] as Msg & { location: { file: string; line: number }; variables: { name: string; value: string }[]; watches: { value: string }[] };
  assert.equal(first.location.file, 'src/main.c');
  assert.equal(first.location.line, 11);
  assert.equal(first.variables.find((v) => v.name === 'a')?.value, '7');
  assert.equal(first.watches[0]?.value, '14');
  const second = states[1] as Msg & { location: { line: number; func: string }; frames: unknown[] };
  assert.equal(second.location.func, 'square');
  assert.equal(second.frames.length, 2);
  assert.match(stdout(msgs), /result=49/);
  assert.equal(exitMsg(msgs).exitCode, 0);
});
