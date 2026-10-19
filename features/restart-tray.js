/**
 * Feature module contract
 * ----------------------
 * Every file in this directory (except `index.js`) is one user-facing switch in
 * the Pro Tools settings page. A feature module is plain data plus one optional
 * contributor:
 *
 *   export const meta = {
 *     id: 'kebab-case-id',          // stable key stored in the plugin Config
 *     order: 10,                    // position inside the settings page
 *     defaultEnabled: true,         // default when Config has no override
 *     title: { zh: '…', en: '…' },
 *     description: { zh: '…', en: '…' },
 *   }
 *
 *   export function tray(context) { return [TrayItem, …] }   // optional surface
 *
 *   TrayItem = {
 *     id: string,                   // unique inside this feature
 *     order: number,
 *     labels: { zh: string, en: string },
 *     action: BuiltinAction | OpenPathAction | OpenUrlAction,
 *   }
 *   BuiltinAction   = { type: 'builtin', name: 'open' | 'restart' | 'quit' }
 *   OpenPathAction  = { type: 'openPath', path: string }
 *   OpenUrlAction   = { type: 'openUrl', url: string }
 *
 * The `context` a `tray()` contributor receives is `{ dir, stateFile, features }`,
 * where `dir` is the Pro Tools data directory and `features` maps feature ids to
 * their enabled state. A feature that only needs the settings page declares no
 * contributor at all — the switch still appears.
 */

/** Tray item: restart the desktop application in place. */
export const meta = {
  id: 'restart-tray',
  order: 10,
  defaultEnabled: true,
  title: {
    zh: '托盘「重启 DeepSeek Harness」',
    en: 'Tray restart item',
  },
  description: {
    zh: '在桌面托盘右键菜单中加入「重启 DeepSeek Harness」，不必先退出再手动打开。',
    en: 'Adds a Restart DeepSeek Harness row to the desktop tray menu, so a restart does not need a quit plus a manual launch.',
  },
};

/** @returns {import('./index.js').TrayItem[]} items contributed while this feature is on. */
export function tray() {
  return [
    {
      id: 'restart',
      order: 10,
      labels: { zh: '重启 DeepSeek Harness', en: 'Restart DeepSeek Harness' },
      action: { type: 'builtin', name: 'restart' },
    },
  ];
}
