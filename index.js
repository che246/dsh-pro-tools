/**
 * Host half of `dsh-pro-tools`.
 *
 * Responsibilities, in order:
 *   1. declare the Config the settings page writes (`tray`, `features`),
 *   2. resolve the feature registry against that Config,
 *   3. deploy the desktop plugin module to `~/.dsh/pro-tools/desktop/plugin.cjs`,
 *      where the Electron main process can load it,
 *   4. publish the switch state to `~/.dsh/pro-tools/state.json`, which the
 *      desktop host polls to rebuild the tray menu,
 *   5. retract the state when the plugin unloads, so the tray never shows rows
 *      that belong to a plugin nobody runs.
 *
 * A Config change travels the normal Loader path, so this `apply` runs again with
 * the new values: the settings page only has to write Config, never talk to the
 * desktop shell.
 *
 * @module dsh-pro-tools
 */

import Schema from '@deepseek-ai/schemastery';
import { FEATURES, resolveFeatureStates } from './features/index.js';
import { deployDesktopPlugin, removeLegacyTrayState, removeState, writeState } from './lib/state-file.js';

/** Config schema of the bundle row; the settings page renders its own controls over it. */
export const Config = Schema.object({
  tray: Schema.boolean()
    .default(true)
    .description('向桌面托盘的 dsh-pro-tools 段写入菜单项（需要已安装 desktop host）。'),
  features: Schema.dict(Schema.boolean())
    .default({})
    .description('按功能 id 覆盖默认开关；未列出的功能使用该功能的默认值。'),
});

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {{ tray?: boolean, features?: Record<string, boolean> }} [config] - resolved Config.
 */
export function apply(ctx, config) {
  const states = resolveFeatureStates(config?.features);
  const trayEnabled = config?.tray !== false;

  const publish = () => {
    if (!trayEnabled) {
      removeState();
      return;
    }
    const deployed = deployDesktopPlugin();
    removeLegacyTrayState();
    const written = writeState(states);
    const enabled = Object.entries(written.features).filter(([, on]) => on === true).map(([id]) => id);
    console.info(`dsh-pro-tools: desktop plugin ${deployed.changed ? 'updated' : 'ready'}, enabled: ${enabled.join(', ') || 'none'}`);
  };

  try {
    publish();
  } catch (error) {
    console.warn('dsh-pro-tools: could not publish the desktop state', error);
  }

  ctx.effect(() => () => {
    try {
      removeState();
    } catch (error) {
      console.warn('dsh-pro-tools: could not retract the desktop state', error);
    }
  }, 'pro-tools: retract desktop state');
}

/** Exported for the verification script: the registry the page renders from. */
export { FEATURES };
