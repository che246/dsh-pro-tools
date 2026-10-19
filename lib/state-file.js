/**
 * Files shared between the dsh bundle (this Host half) and the desktop plugin.
 *
 * `state.json` carries only *which switches are on*; everything the tray needs
 * beyond that (labels, behaviour) is code in `desktop/plugin.cjs`, which is
 * deployed next to the state so the Electron main process can load it without
 * knowing where the package lives.
 *
 * A missing `state.json` means "no contribution": the desktop host then renders
 * the shell's stock menu, which is also what a user sees before the desktop
 * plugin is installed or after this bundle is disabled.
 *
 * @module dsh-pro-tools/state-file
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveProToolsDir, resolveStatePath } from './paths.js';

/** Schema version of the published switch state. */
export const STATE_VERSION = 2;

/**
 * @typedef {{ version: number, generator: string, updatedAt: string,
 *   features: Record<string, boolean> }} ProToolsState
 */

/**
 * Write the switch state atomically (temp file plus rename), so the desktop
 * host's poll never reads a half-written document.
 * @param {Record<string, boolean>} features - enabled state per feature id.
 * @param {{ path?: string }} [options] - override the resolved path (tests).
 * @returns {ProToolsState} what was written.
 */
export function writeState(features, options = {}) {
  const file = options.path ?? resolveStatePath();
  mkdirSync(dirname(file), { recursive: true });
  /** @type {ProToolsState} */
  const payload = {
    version: STATE_VERSION,
    generator: 'dsh-pro-tools',
    updatedAt: new Date().toISOString(),
    features: { ...features },
  };
  const staging = `${file}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  renameSync(staging, file);
  return payload;
}

/**
 * Remove the state file so the desktop host retracts every contributed row.
 * @param {{ path?: string }} [options] - override the resolved path (tests).
 * @returns {boolean} whether the call completed.
 */
export function removeState(options = {}) {
  try {
    rmSync(options.path ?? resolveStatePath(), { force: true });
    return true;
  } catch (error) {
    console.warn('dsh-pro-tools: could not remove the state file', error);
    return false;
  }
}

/**
 * Deploy the desktop plugin module next to the state file.
 *
 * The Electron main process must be able to `require()` a stable path that does
 * not depend on where this npm package was installed, and an update of the
 * package has to reach that path. Copying on every apply, but only when the
 * bytes differ, gives both: the host's mtime poll reloads the module, and an
 * unchanged file stays untouched.
 *
 * @param {{ dir?: string, sourcePath?: string }} [options] - overrides for tests.
 * @returns {{ path: string, changed: boolean }}
 */
export function deployDesktopPlugin(options = {}) {
  const dir = options.dir ?? resolveProToolsDir();
  const sourcePath = options.sourcePath ?? new URL('../desktop/plugin.cjs', import.meta.url);
  const target = join(dir, 'desktop', 'plugin.cjs');
  const source = readFileSync(sourcePath);
  let current;
  try {
    current = readFileSync(target);
  } catch {
    current = undefined;
  }
  const changed = current === undefined || !current.equals(source);
  if (changed) {
    mkdirSync(dirname(target), { recursive: true });
    const staging = `${target}.${process.pid}.tmp`;
    writeFileSync(staging, source);
    renameSync(staging, target);
  }
  return { path: target, changed };
}
