#!/usr/bin/env node
/**
 * Repository self-check: registry resolution, tray projection, generated catalog
 * freshness, and JavaScript syntax of every shipped module.
 *
 * @module dsh-pro-tools/scripts/check
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURES, collectTrayItems, resolveFeatureStates } from '../features/index.js';
import { resolveDshHome, resolveTrayStatePath } from '../lib/paths.js';
import { removeTrayState, writeTrayState } from '../lib/tray-file.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
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

check('registry exposes the restart feature', () => {
  assert(FEATURES.length >= 1, 'registry is empty');
  assert(FEATURES.some((feature) => feature.id === 'restart-tray'), 'restart-tray is missing');
});

check('defaults publish exactly one tray row', () => {
  const states = resolveFeatureStates({});
  const items = collectTrayItems(states, { dir: 'C:/tmp', stateFile: 'C:/tmp/tray.json' });
  assert(items.length === 1, `expected 1 item, got ${String(items.length)}`);
  assert(items[0].labels.zh.length > 0 && items[0].labels.en.length > 0, 'labels are not bilingual');
  assert(items[0].action.type === 'builtin' && items[0].action.name === 'restart', 'action is not the restart verb');
});

check('a disabled feature contributes nothing', () => {
  const states = resolveFeatureStates({ 'restart-tray': false });
  const items = collectTrayItems(states, { dir: 'C:/tmp', stateFile: 'C:/tmp/tray.json' });
  assert(items.length === 0, `expected 0 items, got ${String(items.length)}`);
});

check('an opt-in feature contributes only when enabled', () => {
  const off = resolveFeatureStates({});
  assert(
    collectTrayItems(off, { dir: 'C:/tmp', stateFile: 'C:/tmp/tray.json' }).every((item) => !item.id.startsWith('open-state-folder:')),
    'default-off feature leaked into the tray',
  );
  const on = resolveFeatureStates({ 'open-state-folder': true });
  const items = collectTrayItems(on, { dir: 'C:/tmp/state', stateFile: 'C:/tmp/state/tray.json' });
  const row = items.find((item) => item.id.startsWith('open-state-folder:'));
  assert(row !== undefined, 'enabled opt-in feature is missing');
  assert(row.action.type === 'openPath' && row.action.path === 'C:/tmp/state', 'openPath action did not receive the data directory');
});

check('tray state round-trips through an atomic write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pro-tools-check-'));
  const file = join(dir, 'tray.json');
  try {
    const items = collectTrayItems(resolveFeatureStates({}), { dir, stateFile: file });
    const payload = writeTrayState(items, { path: file });
    assert(payload.items.length === 1, 'payload lost the item');
    assert(removeTrayState({ path: file }) === true, 'removal failed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

check('paths follow DSH_HOME', () => {
  const resolved = resolveTrayStatePath({ DSH_HOME: 'C:/harness-home' });
  assert(resolved.endsWith(join('pro-tools', 'tray.json')), `unexpected path ${resolved}`);
  assert(resolveDshHome({}).length > 0, 'default home did not resolve');
});

check('generated client catalog is current', () => {
  execFileSync(process.execPath, [join(root, 'scripts', 'build-catalog.mjs'), '--check'], { stdio: 'inherit' });
});

for (const file of ['index.js', 'client.js', 'features/index.js', 'features/restart-tray.js', 'features/open-state-folder.js', 'lib/paths.js', 'lib/tray-file.js', 'scripts/build-catalog.mjs', 'desktop/apply-desktop-hook.mjs']) {
  check(`syntax: ${file}`, () => {
    const target = join(root, file);
    if (file.endsWith('.js') && !file.startsWith('scripts/')) {
      // ESM entry files: copy to .mjs so `node --check` parses them as modules.
      const dir = mkdtempSync(join(tmpdir(), 'pro-tools-syntax-'));
      try {
        const copy = join(dir, `${file.replaceAll('/', '_')}.mjs`);
        cpSync(target, copy);
        execFileSync(process.execPath, ['--check', copy], { stdio: 'inherit' });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      return;
    }
    execFileSync(process.execPath, ['--check', target], { stdio: 'inherit' });
  });
}

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('\nall checks passed');
}
