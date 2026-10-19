/**
 * Feature registry.
 *
 * This is the only file that lists feature modules. Adding a switch means:
 *   1. add `features/<id>.js` with `meta`,
 *   2. import it here and add it to `SOURCE`,
 *   3. run `node scripts/build-catalog.mjs` so the settings page sees the switch,
 *   4. implement the behaviour where it runs — `desktop/plugin.cjs` for anything
 *      that needs Electron, filtered by `feature: '<id>'`.
 *
 * Everything else (Config schema, state file, settings page, toggles) derives
 * from this registry.
 *
 * @module dsh-pro-tools/features
 */

import * as openStateFolder from './open-state-folder.js';
import * as restartTray from './restart-tray.js';

/** Every feature module this package ships, in declaration order. */
const SOURCE = [restartTray, openStateFolder];

/**
 * @typedef {{ zh: string, en: string }} LocalizedText
 * @typedef {{ id: string, order: number, defaultEnabled: boolean,
 *   title: LocalizedText, description: LocalizedText }} Feature
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
  const record = /** @type {Record<string, any>} */ (meta);
  if (typeof record.id !== 'string' || record.id.length === 0) {
    console.warn('dsh-pro-tools: feature module without a meta.id was skipped');
    return undefined;
  }
  const labels = (value) => value !== null && typeof value === 'object'
    ? { zh: typeof value.zh === 'string' ? value.zh : '', en: typeof value.en === 'string' ? value.en : '' }
    : { zh: record.id, en: record.id };
  return {
    id: record.id,
    order: Number.isFinite(record.order) ? record.order : 100,
    defaultEnabled: record.defaultEnabled !== false,
    title: labels(record.title),
    description: labels(record.description),
  };
}

/** @type {Feature[]} the shipped registry, sorted by `order`. */
export const FEATURES = SOURCE
  .map(projectFeature)
  .filter((feature) => feature !== undefined)
  .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

/** @type {string[]} the ids the settings page and the desktop plugin share. */
export const FEATURE_IDS = FEATURES.map((feature) => feature.id);

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
