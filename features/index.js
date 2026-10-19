/**
 * Feature registry.
 *
 * This is the only file that lists feature modules. Adding a feature means:
 *   1. add `features/<id>.js` with `meta` and an optional `tray()` contributor,
 *   2. import it here and add it to `SOURCE`,
 *   3. run `node scripts/build-catalog.mjs` so the settings page sees the switch.
 *
 * Everything else — Config schema, tray state file, settings page, toggles —
 * derives from this registry.
 *
 * @module dsh-pro-tools/features
 */

import * as openStateFolder from './open-state-folder.js';
import * as restartTray from './restart-tray.js';

/** Every feature module this package ships, in declaration order. */
const SOURCE = [restartTray, openStateFolder];

/**
 * @typedef {{ zh: string, en: string }} LocalizedText
 * @typedef {{ type: 'builtin', name: 'open' | 'restart' | 'quit' }
 *   | { type: 'openPath', path: string }
 *   | { type: 'openUrl', url: string }} TrayAction
 * @typedef {{ id: string, order?: number, labels: LocalizedText, action: TrayAction }} TrayItem
 * @typedef {{ id: string, order: number, defaultEnabled: boolean,
 *   title: LocalizedText, description: LocalizedText,
 *   tray?: (context: { dir: string, stateFile: string, features: Record<string, boolean> }) => TrayItem[] }} Feature
 */

/**
 * Validate one module and project the registry entry.
 * @param {unknown} module - an imported feature module.
 * @returns {Feature | undefined} the entry, or undefined when the module is malformed.
 */
function projectFeature(module) {
  const meta = /** @type {{ meta?: unknown }} */ (module)?.meta;
  if (meta === null || typeof meta !== 'object') {
    console.warn('dsh-pro-tools: feature module without a meta object was skipped');
    return undefined;
  }
  const id = /** @type {Record<string, unknown>} */ (meta).id;
  if (typeof id !== 'string' || id.length === 0) {
    console.warn('dsh-pro-tools: feature module without a meta.id was skipped');
    return undefined;
  }
  const record = /** @type {Record<string, any>} */ (meta);
  const labels = (value) => value !== null && typeof value === 'object'
    ? { zh: typeof value.zh === 'string' ? value.zh : '', en: typeof value.en === 'string' ? value.en : '' }
    : { zh: id, en: id };
  return {
    id,
    order: Number.isFinite(record.order) ? record.order : 100,
    defaultEnabled: record.defaultEnabled !== false,
    title: labels(record.title),
    description: labels(record.description),
    tray: typeof /** @type {Record<string, unknown>} */ (module).tray === 'function'
      ? /** @type {Feature['tray']} */ (/** @type {Record<string, unknown>} */ (module).tray)
      : undefined,
  };
}

/** @type {Feature[]} the shipped registry, sorted by `order`. */
export const FEATURES = SOURCE
  .map(projectFeature)
  .filter((feature) => feature !== undefined)
  .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

/**
 * Merge Config overrides over the per-feature defaults.
 * @param {Record<string, boolean> | undefined} overrides - `config.features`.
 * @param {readonly Feature[]} [features] - registry to resolve against.
 * @returns {Record<string, boolean>} enabled state per feature id.
 */
export function resolveFeatureStates(overrides, features = FEATURES) {
  /** @type {Record<string, boolean>} */
  const states = {};
  for (const feature of features) {
    const override = overrides === undefined || overrides === null ? undefined : overrides[feature.id];
    states[feature.id] = typeof override === 'boolean' ? override : feature.defaultEnabled;
  }
  return states;
}

/**
 * Flatten the tray contributions of every enabled feature.
 * @param {Record<string, boolean>} states - result of `resolveFeatureStates`.
 * @param {{ dir: string, stateFile: string }} context - paths handed to contributors.
 * @param {readonly Feature[]} [features] - registry to read.
 * @returns {TrayItem[]} ordered tray items, ids namespaced by feature.
 */
export function collectTrayItems(states, context, features = FEATURES) {
  /** @type {TrayItem[]} */
  const items = [];
  for (const feature of features) {
    if (states[feature.id] !== true || feature.tray === undefined) continue;
    let contributed;
    try {
      contributed = feature.tray({ ...context, features: states });
    } catch (error) {
      console.warn(`dsh-pro-tools: tray contributor of "${feature.id}" failed`, error);
      continue;
    }
    if (!Array.isArray(contributed)) continue;
    for (const item of contributed) {
      if (item === null || typeof item !== 'object') continue;
      if (item.action === null || typeof item.action !== 'object') continue;
      const labels = item.labels ?? { zh: '', en: '' };
      items.push({
        id: `${feature.id}:${typeof item.id === 'string' && item.id.length > 0 ? item.id : 'item'}`,
        order: Number.isFinite(item.order) ? item.order : feature.order,
        labels: {
          zh: typeof labels.zh === 'string' ? labels.zh : '',
          en: typeof labels.en === 'string' ? labels.en : '',
        },
        action: item.action,
      });
    }
  }
  return items.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}
