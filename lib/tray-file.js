/**
 * The one file the desktop shell and this plugin share.
 *
 * Writing is atomic (temp file plus rename) so the shell's poll never reads a
 * half-written document. A missing file means "no contribution": the shell then
 * renders its stock tray menu, which is also what a user sees before the hook is
 * installed or after the plugin is disabled.
 *
 * @module dsh-pro-tools/tray-file
 */

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveTrayStatePath } from './paths.js';

/** Schema version of the tray state document. */
export const TRAY_STATE_VERSION = 1;

/**
 * @typedef {{ version: number, generator: string, updatedAt: string,
 *   items: Array<{ id: string, order: number, labels: { zh: string, en: string }, action: object }> }} TrayState
 */

/**
 * Write the tray state document atomically.
 * @param {Array<{ id: string, order: number, labels: { zh: string, en: string }, action: object }>} items
 * @param {{ path?: string }} [options] - override the resolved state path (tests).
 * @returns {TrayState} what was written.
 */
export function writeTrayState(items, options = {}) {
  const file = options.path ?? resolveTrayStatePath();
  mkdirSync(dirname(file), { recursive: true });
  /** @type {TrayState} */
  const payload = {
    version: TRAY_STATE_VERSION,
    generator: 'dsh-pro-tools',
    updatedAt: new Date().toISOString(),
    items: items.map((item) => ({
      id: item.id,
      order: item.order,
      labels: { zh: item.labels.zh, en: item.labels.en },
      action: item.action,
    })),
  };
  const staging = `${file}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  renameSync(staging, file);
  return payload;
}

/**
 * Remove the tray state document, so the shell drops every contributed row.
 * @param {{ path?: string }} [options] - override the resolved state path (tests).
 * @returns {boolean} whether a file was removed.
 */
export function removeTrayState(options = {}) {
  const file = options.path ?? resolveTrayStatePath();
  try {
    rmSync(file, { force: true });
    return true;
  } catch (error) {
    console.warn('dsh-pro-tools: could not remove the tray state file', error);
    return false;
  }
}
