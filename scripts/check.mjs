#!/usr/bin/env node
/**
 * Repository self-check: registry resolution, published state, the desktop plugin
 * contract, generated catalog freshness, and JavaScript syntax of every module.
 *
 * @module dsh-pro-tools/scripts/check
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURE_IDS, FEATURES, resolveFeatureStates } from '../features/index.js';
import { resolveDshHome, resolveStatePath } from '../lib/paths.js';
import { deployDesktopPlugin, removeState, writeState } from '../lib/state-file.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const requireHere = createRequire(import.meta.url);
const failures = [];

/** @param {string} label @param {() => void} run */
function check(label, run) {
  try {
    run();
    console.log(`ok   ${label}`);
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
    console.error(`FAIL ${label}: ${error.message}`);
  }
}

/** @param {unknown} value @param {string} message */
function assert(value, message) {
  if (!value) throw new Error(message);
}

check('registry exposes the restart switch', () => {
  assert(FEATURES.length >= 1, 'registry is empty');
  assert(FEATURE_IDS.includes('restart-tray'), 'restart-tray is missing');
});

check('defaults enable exactly the restart switch', () => {
  const states = resolveFeatureStates({});
  const enabled = Object.entries(states).filter(([, on]) => on === true).map(([id]) => id);
  assert(JSON.stringify(enabled) === JSON.stringify(['restart-tray']), `unexpected defaults: ${JSON.stringify(enabled)}`);
});

check('a disabled switch contributes nothing', () => {
  const states = resolveFeatureStates({ 'restart-tray': false });
  assert(Object.values(states).every((on) => on === false), 'a disabled switch stayed on');
});

check('state round-trips through an atomic write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pro-tools-state-'));
  const file = join(dir, 'state.json');
  try {
    const payload = writeState({ 'restart-tray': true }, { path: file });
    assert(payload.features['restart-tray'] === true, 'payload lost the switch');
    assert(payload.version === 2, 'unexpected state version');
    assert(removeState({ path: file }) === true, 'removal failed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

check('desktop plugin deploys once and stays put', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pro-tools-deploy-'));
  try {
    const first = deployDesktopPlugin({ dir });
    assert(first.changed === true, 'first deploy did not copy');
    const second = deployDesktopPlugin({ dir });
    assert(second.changed === false, 'second deploy rewrote an identical file');
    const text = readFileSync(second.path, 'utf8');
    assert(text.includes('dsh-pro-tools'), 'deployed file does not look like the plugin');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

check('desktop plugin declares only known switches', () => {
  const plugin = requireHere(join(root, 'desktop', 'plugin.cjs'));
  assert(typeof plugin.trayItems === 'function', 'trayItems() is missing');
  assert(typeof plugin.id === 'string' && plugin.id.length > 0, 'plugin id is missing');
  const all = Object.fromEntries(FEATURE_IDS.map((id) => [id, true]));
  const rows = plugin.trayItems({
    state: { features: all },
    locale: 'zh',
    app: { relaunch() {}, quit() {} },
    shell: { openPath() {} },
    dataDir: 'C:/tmp/pro-tools',
  });
  assert(Array.isArray(rows) && rows.length === 2, `expected 2 rows, got ${String(rows?.length)}`);
  for (const row of rows) {
    assert(FEATURE_IDS.includes(row.feature), `row "${row.id}" names an unknown switch: ${String(row.feature)}`);
    assert(row.label.zh.length > 0 && row.label.en.length > 0, `row "${row.id}" is not bilingual`);
  }
});

check('desktop plugin respects the switch state', () => {
  const plugin = requireHere(join(root, 'desktop', 'plugin.cjs'));
  const rows = plugin.trayItems({
    state: { features: { 'restart-tray': false, 'open-state-folder': false } },
    locale: 'en',
    app: {},
    shell: {},
  });
  assert(rows.length === 0, `disabled switches produced ${String(rows.length)} row(s)`);
});

check('desktop plugin restart row relaunches and quits', () => {
  const plugin = requireHere(join(root, 'desktop', 'plugin.cjs'));
  const calls = [];
  const rows = plugin.trayItems({
    state: { features: { 'restart-tray': true } },
    locale: 'en',
    app: { relaunch: () => calls.push('relaunch'), quit: () => calls.push('quit') },
    shell: {},
    quitWithoutConfirmation: () => calls.push('quitNow'),
  });
  const handled = rows[0].run({ app: { relaunch: () => calls.push('relaunch'), quit: () => calls.push('quit') }, quitWithoutConfirmation: () => calls.push('quitNow') });
  assert(handled === true, 'restart row did not report handled');
  assert(calls.includes('relaunch') && calls.includes('quitNow'), `unexpected calls: ${JSON.stringify(calls)}`);
});

check('desktop plugin folder row needs a directory', () => {
  const plugin = requireHere(join(root, 'desktop', 'plugin.cjs'));
  const rows = plugin.trayItems({ state: { features: { 'open-state-folder': true } }, locale: 'zh', app: {}, shell: {} });
  assert(rows.length === 1, 'folder row missing');
  const opened = [];
  assert(rows[0].run({ shell: { openPath: (path) => opened.push(path) }, dataDir: 'C:/tmp/pro-tools' }) === true, 'folder row did not report handled');
  assert(opened[0] === 'C:/tmp/pro-tools', 'folder row opened the wrong path');
  assert(rows[0].run({ shell: {} }) === false, 'folder row claimed handled without a shell');
});

check('paths follow DSH_HOME', () => {
  const resolved = resolveStatePath({ DSH_HOME: 'C:/harness-home' });
  assert(resolved.endsWith(join('pro-tools', 'state.json')), `unexpected path ${resolved}`);
  assert(resolveDshHome({}).length > 0, 'default home did not resolve');
});

check('generated client catalog is current', () => {
  execFileSync(process.execPath, [join(root, 'scripts', 'build-catalog.mjs'), '--check'], { stdio: 'inherit' });
});

const syntaxTargets = [
  'index.js',
  'client.js',
  'features/index.js',
  'features/restart-tray.js',
  'features/open-state-folder.js',
  'lib/paths.js',
  'lib/state-file.js',
  'desktop/plugin.cjs',
  'desktop/tray-hook.js',
  'scripts/build-catalog.mjs',
  'desktop/apply-desktop-hook.mjs',
  'desktop/hook-test.mjs',
];
for (const file of syntaxTargets) {
  check(`syntax: ${file}`, () => {
    const target = join(root, file);
    const dir = mkdtempSync(join(tmpdir(), 'pro-tools-syntax-'));
    try {
      // Copy as .mjs for module sources and .cjs for CommonJS, whatever the package type.
      const esm = !file.endsWith('.cjs');
      const copy = join(dir, `${file.replaceAll('/', '_')}${esm ? '.mjs' : '.cjs'}`);
      cpSync(target, copy);
      execFileSync(process.execPath, ['--check', copy], { stdio: 'inherit' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('\nall checks passed');
}
