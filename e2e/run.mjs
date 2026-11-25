/**
 * End-to-end test: real browser (Chrome via playwright-core) + real backend + real GCC.
 * Usage: npm run build && node e2e/run.mjs   (needs Chrome at CHROME_PATH or /usr/bin/google-chrome,
 * and root privileges for the native sandbox)
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8791;
const URL_ = `http://127.0.0.1:${PORT}/`;
const shots = join(root, 'e2e', 'screenshots');
mkdirSync(shots, { recursive: true });
const results = [];
const pageErrors = [];

function step(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function startBackend() {
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: join(root, 'backend'),
    env: { ...process.env, CSTUDIO_PORT: String(PORT), CSTUDIO_HOST: '127.0.0.1', CSTUDIO_STATIC: join(root, 'dist'), CSTUDIO_LOG: 'warn', CSTUDIO_RPM: '100000' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(URL_ + 'api/health')).ok) return proc;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('backend not started');
}

async function zipOf(name, files) {
  const z = new JSZip();
  for (const [p, c] of Object.entries(files)) z.file(`${name}/${p}`, c);
  const path = join(shots, `${name}.zip`);
  writeFileSync(path, await z.generateAsync({ type: 'nodebuffer' }));
  return path;
}

const SUM = `#include <stdio.h>

int main(void) {
    int a, b;
    printf("Inserisci due numeri: ");
    scanf("%d %d", &a, &b);
    printf("Somma: %d\\n", a + b);
    return 0;
}
`;
const DIV = `#include <stdio.h>

int main(void) {
    int x = 10;
    int y = 0;
    printf("%d\\n", x / y);
    return 0;
}
`;
const BROKEN = `#include <stdio.h>

int main(void) {
    int x = 5
    printf("%d\\n", y);
    return 0;
}
`;
const DEBUGGABLE = `#include <stdio.h>

int square(int v) {
    int r = v * v;
    return r;
}

int main(void) {
    int a = 6;
    int b = square(a);
    printf("b=%d\\n", b);
    return 0;
}
`;

async function importZip(page, file) {
  await page.getByRole('button', { name: 'Altri comandi' }).click();
  // fall back to the command palette if the menu item is not there (welcome screen)
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+P');
  await page.getByPlaceholder(/Cerca file|Digita >/).fill('>Importa progetto');
  await page.keyboard.press('Enter');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Progetto da archivio ZIP/ }).click();
  await (await chooser).setFiles(file);
  const name = file.split('/').pop().replace('.zip', '');
  await page.locator('.crumbs', { hasText: name }).waitFor({ timeout: 30000 });
  await page.locator('.monaco-editor').first().waitFor({ timeout: 30000 });
}

async function runAndWait(page, text, timeout = 30000) {
  await page.keyboard.press('Control+F5');
  await page.locator('.panel .console').filter({ hasText: text }).first().waitFor({ timeout });
}

const main = async () => {
  const backend = await startBackend();
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  try {
    /* ───────── PWA icons (rendered from the SVG) ───────── */
    {
      const p = await browser.newPage({ viewport: { width: 512, height: 512 } });
      for (const [svg, out, size] of [['icon.svg', 'icon-192.png', 192], ['icon.svg', 'icon-512.png', 512], ['maskable.svg', 'maskable-512.png', 512]]) {
        await p.setViewportSize({ width: size, height: size });
        await p.setContent(`<html><body style="margin:0;background:transparent"><img src="${URL_}icons/${svg}" style="width:${size}px;height:${size}px;display:block"></body></html>`);
        await p.waitForTimeout(150);
        const buf = await p.screenshot({ omitBackground: true });
        writeFileSync(join(root, 'public', 'icons', out), buf);
        writeFileSync(join(root, 'dist', 'icons', out), buf);
      }
      await p.close();
      step('Icone PWA generate', true);
    }

    /* ───────── Desktop ───────── */
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && pageErrors.push(m.text()));
    await page.goto(URL_);
    await page.getByText('Nuovo progetto C').waitFor({ timeout: 20000 });
    await page.waitForFunction(() => document.querySelector('.status-card')?.textContent?.includes('Compilatore disponibile'), null, { timeout: 15000 });
    await page.screenshot({ path: join(shots, '01-welcome-desktop.png') });
    step('Splash → Welcome, backend online', true);

    // Test 1: create Hello World project, compile & run
    await page.getByText('Nuovo progetto C').click();
    await page.getByLabel('Nome progetto').fill('hello-test');
    await page.getByRole('button', { name: /Hello World/ }).click();
    await page.getByRole('button', { name: 'Crea progetto' }).click();
    await page.locator('.monaco-editor').first().waitFor({ timeout: 30000 });
    await page.locator('.view-lines').filter({ hasText: 'Hello, World!' }).waitFor();
    step('Creazione progetto da template + apertura main.c', true);
    await runAndWait(page, 'Hello, World!');
    await page.locator('.panel').filter({ hasText: 'Programma terminato con codice 0' }).waitFor({ timeout: 10000 });
    await page.screenshot({ path: join(shots, '02-hello-run-desktop.png') });
    step('Test 1: Hello World compilato ed eseguito (exit 0)', true);

    // Explorer: create a file through the UI, edit and save
    await page.getByRole('button', { name: 'Nuovo file' }).first().click();
    await page.locator('#prompt-input').fill('src/util.h');
    await page.getByRole('button', { name: 'Crea' }).click();
    await page.locator('.tab', { hasText: 'util.h' }).waitFor();
    const guardOk = await page.locator('.view-lines', { hasText: 'UTIL_H' }).waitFor({ timeout: 10000 }).then(() => true, () => false);
    step('Creazione file .h con header guard', guardOk);
    await page.locator('.view-lines').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('// nota');
    await page.locator('.tab.dirty', { hasText: 'util.h' }).waitFor();
    await page.keyboard.press('Control+S');
    await page.locator('.tab:not(.dirty)', { hasText: 'util.h' }).waitFor();
    step('Modifica + salvataggio (indicatore schede)', true);

    // Reload → project & tabs restored from IndexedDB
    await page.reload();
    await page.locator('.tab', { hasText: 'util.h' }).waitFor({ timeout: 20000 });
    step('Recupero sessione dopo ricarica (progetto e schede)', true);

    // Test 2: interactive input
    await importZip(page, await zipOf('somma', { 'src/main.c': SUM }));
    await page.keyboard.press('Control+F5');
    await page.locator('.panel .console').filter({ hasText: 'Inserisci due numeri:' }).waitFor({ timeout: 30000 });
    await page.getByLabel('Input del programma').fill('17 25');
    await page.getByLabel('Input del programma').press('Enter');
    await page.locator('.panel .console').filter({ hasText: 'Somma: 42' }).waitFor({ timeout: 10000 });
    await page.screenshot({ path: join(shots, '03-input-run-desktop.png') });
    step('Test 2: importazione ZIP + input interattivo → "Somma: 42"', true);

    // Test 3: division by zero is a runtime error, not a compile error
    await importZip(page, await zipOf('divzero', { 'src/main.c': DIV }));
    await runAndWait(page, 'SIGFPE');
    const errs = await page.locator('.panel-tab', { hasText: 'Problems' }).locator('.chip.err').count();
    await page.screenshot({ path: join(shots, '04-sigfpe-desktop.png') });
    step('Test 3: divisione per zero → errore runtime SIGFPE (nessun errore di compilazione)', errs === 0);

    // Compile error → Problems with location; click navigates
    await importZip(page, await zipOf('broken', { 'src/main.c': BROKEN }));
    await page.keyboard.press('F7');
    await page.locator('.problem').first().waitFor({ timeout: 30000 });
    const loc = await page.locator('.problem .loc').first().textContent();
    await page.locator('.problem').first().click();
    await page.waitForTimeout(300);
    const statusLn = await page.locator('.statusbar').textContent();
    await page.screenshot({ path: join(shots, '05-problems-desktop.png') });
    step('Errori di compilazione in Problems con file:riga:colonna e navigazione', /src\/main\.c:\d+:\d+/.test(loc ?? '') && /Ln [45],/.test(statusLn ?? ''), `${loc} / ${statusLn?.match(/Ln \d+, Col \d+/)?.[0]}`);

    // Debugger: breakpoint (F9) + start (F5) + locals + step
    await importZip(page, await zipOf('debugme', { 'src/main.c': DEBUGGABLE }));
    await page.locator('.view-lines').click();
    await page.keyboard.press('Control+G');
    await page.keyboard.type('10');
    await page.keyboard.press('Enter');
    await page.keyboard.press('F9');
    await page.locator('.bp-glyph').first().waitFor();
    await page.keyboard.press('F5');
    await page.locator('.chip', { hasText: /In pausa/ }).waitFor({ timeout: 40000 });
    const vars = await page.locator('.debug-grid').textContent();
    await page.keyboard.press('F11');
    await page.locator('.chip', { hasText: /square\(\)/ }).waitFor({ timeout: 15000 });
    await page.screenshot({ path: join(shots, '06-debugger-desktop.png') });
    await page.keyboard.press('F5');
    await page.locator('.debug-grid .console').filter({ hasText: 'b=36' }).waitFor({ timeout: 15000 });
    step('Debugger GDB: breakpoint, variabili locali, step into, continue', /a\s*int\s*= 6/.test(vars ?? ''), '');

    // Terminal: real commands + gcc + ./app
    await page.keyboard.press('Control+`');
    const term = page.getByLabel('Comando del terminale');
    await term.fill('ls src');
    await term.press('Enter');
    await term.fill('gcc -Wall src/main.c');
    await term.press('Enter');
    await page.locator('.console').filter({ hasText: 'Compilazione riuscita' }).waitFor({ timeout: 30000 });
    await term.fill('./app');
    await term.press('Enter');
    await page.locator('.console').filter({ hasText: 'b=36' }).waitFor({ timeout: 20000 });
    await page.screenshot({ path: join(shots, '07-terminal-desktop.png') });
    step('Terminale: ls, gcc, ./app', true);

    // Split editor + settings + theme
    await page.keyboard.press('Control+\\');
    await page.locator('.editor-group').nth(1).waitFor();
    step('Editor diviso (vista verticale)', (await page.locator('.editor-group').count()) === 2);
    await page.keyboard.press('Control+,');
    await page.getByRole('button', { name: /Chiaro/ }).click();
    await page.screenshot({ path: join(shots, '08-settings-light.png') });
    await page.getByRole('button', { name: /OLED Black/ }).click();
    await page.getByRole('button', { name: /Scuro/ }).click();
    await page.keyboard.press('Escape');
    step('Impostazioni e cambio tema', true);

    // Export ZIP
    const dl = page.waitForEvent('download');
    await page.keyboard.press('Control+Shift+P');
    await page.getByPlaceholder(/Cerca file|Digita >/).fill('>Esporta');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /Esporta progetto corrente/ }).click();
    const d = await dl;
    step('Esportazione ZIP', /\.zip$/.test(d.suggestedFilename()), d.suggestedFilename());
    await ctx.close();

    /* ───────── iPad landscape / portrait, phone ───────── */
    for (const [name, viewport] of [['tablet-landscape', { width: 1180, height: 820 }], ['tablet-portrait', { width: 820, height: 1180 }], ['phone', { width: 390, height: 844 }]]) {
      const c = await browser.newContext({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      const p = await c.newPage();
      p.on('pageerror', (e) => pageErrors.push(`${name}: ${e.message}`));
      await p.goto(URL_);
      await p.getByText('Nuovo progetto C').waitFor({ timeout: 20000 });
      await p.screenshot({ path: join(shots, `10-${name}-welcome.png`) });
      await p.getByText('Nuovo progetto C').tap();
      await p.getByLabel('Nome progetto').fill(`multi-${name}`);
      await p.getByRole('button', { name: /Multi-file Project/ }).tap();
      await p.getByRole('button', { name: 'Crea progetto' }).tap();
      await p.locator('.monaco-editor').first().waitFor({ timeout: 30000 });
      await p.locator('.view-lines').first().tap();
      await p.waitForTimeout(400);
      const keybar = await p.locator('.keybar').count();
      // horizontal overflow check
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1);
      await p.screenshot({ path: join(shots, `11-${name}-editor.png`) });
      // tablet key bar inserts at cursor
      if (keybar) {
        await p.keyboard.press('Control+End');
        await p.locator('.keybar button', { hasText: '#' }).first().dispatchEvent('pointerdown');
        const txt = await p.locator('.view-lines').first().textContent();
        step(`${name}: barra simboli inserisce al cursore`, (txt ?? '').trimEnd().endsWith('#'));
      }
      if (name === 'phone') {
        await p.getByRole('button', { name: /^Run/ }).tap();
        await p.getByRole('button', { name: /Compila ed esegui/ }).first().tap();
        await p.locator('.console').filter({ hasText: 'max_of' }).waitFor({ timeout: 30000 });
        await p.screenshot({ path: join(shots, `12-${name}-run.png`) });
        await p.getByRole('button', { name: /^File/ }).tap();
        await p.locator('.drawer .tree-row').first().waitFor();
        await p.screenshot({ path: join(shots, `13-${name}-drawer.png`) });
      } else {
        await p.keyboard.press('Control+F5');
        await p.locator('.console').filter({ hasText: 'max_of' }).waitFor({ timeout: 30000 });
        await p.screenshot({ path: join(shots, `12-${name}-run.png`) });
        if (name === 'tablet-portrait') {
          await p.getByRole('button', { name: 'Apri pannello laterale' }).tap();
          await p.locator('.drawer .tree-row').first().waitFor();
          await p.screenshot({ path: join(shots, `13-${name}-drawer.png`) });
        }
      }
      step(`${name}: layout, progetto multi-file compilato ed eseguito, nessun overflow orizzontale`, !overflow, `keybar=${keybar}`);
      await c.close();
    }

    /* ───────── Offline (service worker) ───────── */
    {
      const c = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const p = await c.newPage();
      await p.goto(URL_);
      await p.getByText('Nuovo progetto C').waitFor({ timeout: 20000 });
      await p.getByText('Nuovo progetto C').click();
      await p.getByLabel('Nome progetto').fill('offline-test');
      await p.getByRole('button', { name: 'Crea progetto' }).click();
      await p.locator('.monaco-editor').first().waitFor({ timeout: 30000 });
      await p.evaluate(() => navigator.serviceWorker.ready);
      await p.waitForTimeout(3000); // let the SW precache every asset
      await c.setOffline(true);
      await p.reload();
      await p.locator('.monaco-editor').first().waitFor({ timeout: 20000 }); // last project reopened from IndexedDB, code from SW cache
      await p.waitForFunction(() => document.querySelector('.statusbar')?.textContent?.includes('non disponibile'), null, { timeout: 15000 });
      const disabled = await p.getByRole('button', { name: 'Compila', exact: true }).isDisabled();
      await p.locator('.view-lines').click();
      await p.keyboard.type('// offline edit');
      await p.keyboard.press('Control+S');
      await p.locator('.statusbar', { hasText: 'Salvato' }).waitFor({ timeout: 5000 });
      await p.screenshot({ path: join(shots, '14-offline.png') });
      step('Offline: app ed editor dalla cache del service worker, modifica e salvataggio locali, compilazione disabilitata con spiegazione', disabled);
      await c.close();
    }
  } catch (e) {
    step('ERRORE durante il test', false, e.message.split('\n').slice(0, 3).join(' '));
    for (const ctx of browser.contexts()) for (const pg of ctx.pages()) await pg.screenshot({ path: join(shots, 'failure.png') }).catch(() => undefined);
  } finally {
    await browser.close();
    backend.kill('SIGTERM');
  }
  step('Nessun errore JavaScript nelle pagine', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  writeFileSync(join(shots, 'results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} verifiche superate`);
  process.exit(failed.length ? 1 : 0);
};

main();
