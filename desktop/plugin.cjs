/**
 * dsh-pro-tools — desktop plugin (Electron main process).
 *
 * This file is the plugin proper: it is loaded into the DeepSeek Harness desktop
 * shell by the small host region the installer injects into `main.js`. It owns
 * everything that needs desktop power — tray rows, their labels, and what runs
 * when a row is clicked — so a new desktop capability is a change here (plus a
 * switch in the settings page), never a change to the shell host.
 *
 * Contract with the host region (`desktop/tray-hook.js`):
 *
 *   module.exports = {
 *     id: string,
 *     version: number,
 *     trayItems(context) -> TrayRow[],
 *   }
 *
 *   context = {
 *     state,          // { features: { [featureId]: boolean } } from the dsh bundle
 *     locale,         // 'zh' | 'en' — the shell's UI language
 *     app, Menu, shell, dialog, Notification, BrowserWindow,   // Electron APIs
 *   }
 *
 *   TrayRow = {
 *     id: string,                 // unique inside this plugin
 *     order?: number,             // lower is closer to the top
 *     feature?: string,           // the switch that owns the row (enabled by caller)
 *     label: { zh: string, en: string },
 *     run?: (api) => boolean,     // return true when handled
 *     action?: BuiltinAction,     // host-handled fallback: open | restart | quit | openPath | openUrl
 *   }
 *
 * The host already filters rows by their `feature`, so `trayItems` may return
 * rows unconditionally and let the switch decide.
 */

'use strict';

/** Localized tray text for a row id. */
const TEXT = {
  restart: {
    zh: '重启 DeepSeek Harness',
    en: 'Restart DeepSeek Harness',
  },
  'open-folder': {
    zh: '打开 Pro Tools 数据目录',
    en: 'Open Pro Tools data folder',
  },
};

/**
 * Restart the whole desktop application, skipping the quit confirmation the way
 * the shell's own restart paths do. `app.relaunch()` is queued before the quit,
 * so the new instance starts only after this one is gone.
 * @param {Record<string, any>} api - Electron APIs handed in by the host.
 * @returns {boolean} whether the action ran.
 */
function restart(api) {
  if (!api || typeof api.app?.relaunch !== 'function') return false;
  api.app.relaunch();
  // `app.exit` would skip the shell's graceful teardown; `app.quit` with the
  // host's skip flag is preferred when available.
  if (typeof api.quitWithoutConfirmation === 'function') api.quitWithoutConfirmation();
  else api.app.quit();
  return true;
}

/**
 * Open the Pro Tools data directory with the OS file manager.
 * @param {Record<string, any>} api - Electron APIs handed in by the host.
 * @returns {boolean} whether the action ran.
 */
function openDataFolder(api) {
  const dir = api?.dataDir;
  if (typeof dir !== 'string' || dir.length === 0 || typeof api.shell?.openPath !== 'function') return false;
  api.shell.openPath(dir);
  return true;
}

module.exports = {
  id: 'dsh-pro-tools',
  version: 2,

  /**
   * Render the tray rows for the current switch state.
   * @param {Record<string, any>} context - see the module header.
   * @returns {Array<Record<string, any>>}
   */
  trayItems(context) {
    const state = context?.state ?? {};
    const features = state.features ?? {};
    const rows = [];

    if (features['restart-tray'] === true) {
      rows.push({
        id: 'restart',
        order: 10,
        feature: 'restart-tray',
        label: TEXT.restart,
        run: (api) => restart(api),
      });
    }

    if (features['open-state-folder'] === true) {
      rows.push({
        id: 'open-folder',
        order: 20,
        feature: 'open-state-folder',
        label: TEXT['open-folder'],
        run: (api) => openDataFolder(api),
      });
    }

    return rows;
  },
};
