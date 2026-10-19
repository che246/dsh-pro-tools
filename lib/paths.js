/**
 * Shared path resolution for the Host half and for the desktop hook script.
 *
 * The desktop shell and this Host plugin must agree on one location without
 * talking to each other: `$DSH_HOME` when the environment sets it, `~/.dsh`
 * otherwise. The shell resolves the same rule through `app.getPath('home')`.
 *
 * @module dsh-pro-tools/paths
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

/** Environment variable the Harness honors for its home directory. */
export const DSH_HOME_ENV = 'DSH_HOME';

/**
 * @param {NodeJS.ProcessEnv} [env] - environment to read (defaults to process.env).
 * @returns {string} the Harness home directory.
 */
export function resolveDshHome(env = process.env) {
  const configured = env?.[DSH_HOME_ENV];
  if (typeof configured === 'string' && configured.trim().length > 0) return configured.trim();
  return join(homedir(), '.dsh');
}

/**
 * @param {NodeJS.ProcessEnv} [env] - environment to read.
 * @returns {string} the directory holding Pro Tools state files.
 */
export function resolveProToolsDir(env = process.env) {
  return join(resolveDshHome(env), 'pro-tools');
}

/**
 * @param {NodeJS.ProcessEnv} [env] - environment to read.
 * @returns {string} the tray state file the desktop hook polls.
 */
export function resolveTrayStatePath(env = process.env) {
  return join(resolveProToolsDir(env), 'tray.json');
}
