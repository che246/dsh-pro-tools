/**
 * Host half of `dsh-pro-tools`.
 *
 * Responsibilities, in order:
 *   1. declare the Config the settings page writes (`tray`, `features`),
 *   2. resolve the feature registry against that Config,
 *   3. publish the enabled tray contributions to `~/.dsh/pro-tools/tray.json`,
 *      which the desktop shell hook reads and polls,
 *   4. retract the file when the plugin unloads, so the tray never shows rows
 *      that belong to a plugin nobody runs.
 *
 * A Config change travels the normal Loader path, so this `apply` runs again with
 * the new values: the settings page only has to write Config, never talk to the
 * desktop shell.
 *
 * @module dsh-pro-tools
 */

import Schema from '@deepseek-ai/schemastery';
import { FEATURES, collectTrayItems, resolveFeatureStates } from './features/index.js';
import { resolveProToolsDir, resolveTrayStatePath } from './lib/paths.js';
import { removeTrayState, writeTrayState } from './lib/tray-file.js';

/** Config schema of the bundle row; the settings page renders its own controls over it. */
export const Config = Schema.object({
  tray: Schema.boolean()
    .default(true)
    .description('向桌面托盘的 dsh-pro-tools 段写入菜单项（需要已安装 desktop hook）。'),
  features: Schema.dict(Schema.boolean())
    .default({})
    .description('按功能 id 覆盖默认开关；未列出的功能使用该功能的默认值。'),
});

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {{ tray?: boolean, features?: Record<string, boolean> }} [config] - resolved Config.
 */
export function apply(ctx, config) {
  const overrides = config?.features ?? {};
  const trayEnabled = config?.tray !== false;
  const states = resolveFeatureStates(overrides);

  /** Publish the current state; a missing file is the "nothing contributed" state. */
  const publish = () => {
    if (!trayEnabled) {
      removeTrayState();
      return;
    }
    const items = collectTrayItems(states, {
      dir: resolveProToolsDir(),
      stateFile: resolveTrayStatePath(),
    });
    const written = writeTrayState(items);
    console.info(`dsh-pro-tools: published ${String(written.items.length)} tray item(s)`);
  };

  try {
    publish();
  } catch (error) {
    console.warn('dsh-pro-tools: could not publish the tray state file', error);
  }

  ctx.effect(() => () => {
    try {
      removeTrayState();
    } catch (error) {
      console.warn('dsh-pro-tools: could not retract the tray state file', error);
    }
  }, 'pro-tools: retract tray state');
}

/** Exported for the verification script: the registry the page renders from. */
export { FEATURES };
