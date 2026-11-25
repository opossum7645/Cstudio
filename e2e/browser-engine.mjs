/**
 * End-to-end test of the in-browser compiler (no backend at all, like GitHub Pages).
 * Usage: npm run build && node e2e/browser-engine.mjs
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4179;
const BASE = `http://localhost:${PORT}/cstudio/`; // sub-path like GitHub Pages
const shots = join(root, 'e2e', 'screenshots');
mkdirSync(shots, { recursive: true });
const results = [];
const errors = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`);
};

const SRC = {
  hello: '#include <stdio.h>\n\nint main(void) {\n    printf("Hello, World!\\n");\n    return 0;\n}\n',
  somma: '#include <stdio.h>\n\nint main(void) {\n    int a, b;\n    printf("Inserisci due numeri: ");\n    scanf("%d %d", &a, &b);\n    printf("Somma: %d\\n", a + b);\n    return 0;\n}\n',
  divzero: '#include <stdio.h>\n\nint main(void) {\n    int x = 10;\n    int y = 0;\n    printf("%d\\n", x / y);\n    return 0;\n}\n',
  broken: '#include <stdio.h>\n\nint main(void) {\n    int x = 5\n    printf("%d\\n", y);\n    return 0;\n}\n',
  loop: 'int main(void) { volatile int x = 0; for (;;) x++; }\n',
};

async function zipOf(name, files) {
  const z = new JSZip();
  for (const [p, c] of Object.entries(files)) z.file(`${name}/${p}`, c);
  const path = join(shots, `${name}.zip`);
  writeFileSync(path, await z.generateAsync({ type: 'nodebuffer' }));
  return path;
}

async function importZip(page, file) {
  await page.keyboard.press('Control+Shift+P');
  await page.getByPlaceholder(/Cerca file|Digita >/).fill('>Importa progetto');
  await page.keyboard.press('Enter');
  const btn = page.getByRole('button', { name: /Progetto da archivio ZIP/ });
  await btn.waitFor({ timeout: 15000 });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), btn.click()]);
  await chooser.setFiles(file);
  await page.locator('.crumbs', { hasText: file.split('/').pop().replace('.zip', '') }).waitFor({ timeout: 30000 });
  await page.locator('.monaco-editor').first().waitFor({ timeout: 30000 });
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--base', '/cstudio/'], { cwd: root, stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE);
  await page.getByText('Nuovo progetto C').waitFor({ timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('.status-card')?.textContent?.includes('nel browser'), null, { timeout: 15000 });
  await page.screenshot({ path: join(shots, '20-browser-engine-welcome.png') });
  step('Senza server: rileva il compilatore nel browser', true);

  await page.evaluate(() => navigator.serviceWorker.ready);
  await importZip(page, await zipOf('hello', { 'src/main.c': SRC.hello }));
  const t0 = Date.now();
  await page.keyboard.press('Control+F5');
  await page.locator('.panel .console').filter({ hasText: 'Hello, World!' }).waitFor({ timeout: 180000 });
  await page.locator('.panel').filter({ hasText: 'Programma terminato con codice 0' }).waitFor({ timeout: 10000 });
  step('Test 1: Hello World compilato (Clang WASM) ed eseguito', true, `primo avvio con download: ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  const t1 = Date.now();
  await page.keyboard.press('Control+F5');
  await page.locator('.panel').filter({ hasText: /Programma terminato con codice 0 in/ }).waitFor({ timeout: 30000 });
  step('Ricompilazione con toolchain in cache', true, `${((Date.now() - t1) / 1000).toFixed(1)} s`);

  await importZip(page, await zipOf('somma', { 'src/main.c': SRC.somma }));
  await page.keyboard.press('Control+F5');
  await page.locator('.panel .console').filter({ hasText: 'Inserisci due numeri:' }).waitFor({ timeout: 60000 });
  await page.getByLabel('Input del programma').fill('17 25');
  await page.getByLabel('Input del programma').press('Enter');
  await page.locator('.panel .console').filter({ hasText: 'Somma: 42' }).waitFor({ timeout: 15000 });
  await page.screenshot({ path: join(shots, '21-browser-engine-input.png') });
  step('Test 2: input interattivo (prompt prima di scanf) → "Somma: 42"', true);

  await importZip(page, await zipOf('divzero', { 'src/main.c': SRC.divzero }));
  await page.keyboard.press('Control+F5');
  await page.locator('.panel .console').filter({ hasText: 'SIGFPE' }).waitFor({ timeout: 60000 });
  const compileErrs = await page.locator('.panel-tab', { hasText: 'Problems' }).locator('.chip.err').count();
  await page.screenshot({ path: join(shots, '22-browser-engine-sigfpe.png') });
  step('Test 3: divisione per zero → errore runtime (SIGFPE), non di compilazione', compileErrs === 0);

  await importZip(page, await zipOf('broken', { 'src/main.c': SRC.broken }));
  await page.keyboard.press('F7');
  await page.locator('.problem').first().waitFor({ timeout: 60000 });
  const loc = await page.locator('.problem .loc').first().textContent();
  step('Errori di compilazione con file:riga:colonna', /src\/main\.c:\d+:\d+/.test(loc ?? ''), loc ?? '');

  await importZip(page, await zipOf('loop', { 'src/main.c': SRC.loop }));
  await page.keyboard.press('Control+F5');
  await page.locator('.chip', { hasText: /In esecuzione/ }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Interrompi/ }).click();
  await page.locator('.panel .console').filter({ hasText: 'interrotta dall’utente' }).waitFor({ timeout: 10000 });
  step('Ciclo infinito interrotto con Stop', true);

  // terminal path uses the same engine
  await page.keyboard.press('Control+`');
  const term = page.getByLabel('Comando del terminale');
  await importZip(page, await zipOf('term', { 'src/main.c': SRC.hello }));
  await page.keyboard.press('Control+`');
  await term.fill('gcc src/main.c');
  await term.press('Enter');
  await page.locator('.console').filter({ hasText: 'Compilazione riuscita' }).waitFor({ timeout: 60000 });
  await term.fill('./app');
  await term.press('Enter');
  await page.locator('.console').filter({ hasText: 'Hello, World!' }).waitFor({ timeout: 30000 });
  step('Terminale: gcc + ./app nel browser', true);

  // offline: toolchain served from cache
  await ctx.setOffline(true);
  await page.reload();
  await page.locator('.monaco-editor').first().waitFor({ timeout: 30000 });
  await page.keyboard.press('Control+F5');
  await page.locator('.panel .console').filter({ hasText: 'Hello, World!' }).waitFor({ timeout: 120000 });
  step('Offline: compilazione ed esecuzione dalla cache', true);
  await ctx.close();
} catch (e) {
  step('ERRORE', false, e.message.split('\n').slice(0, 3).join(' '));
  for (const c of browser.contexts()) for (const p of c.pages()) await p.screenshot({ path: join(shots, 'failure-browser-engine.png') }).catch(() => undefined);
} finally {
  await browser.close();
  server.kill();
}
step('Nessun errore JavaScript', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} verifiche superate`);
process.exit(failed ? 1 : 0);
