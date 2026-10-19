/**
 * Tray item: open the Pro Tools data directory in the OS file manager.
 *
 * Kept as a second example on purpose: it shows a desktop capability that is
 * neither a built-in application verb nor a settings-only switch, and it is off
 * by default so it never clutters a fresh install.
 *
 * The row itself is declared in `desktop/plugin.cjs`; this file only owns the
 * switch that turns it on.
 */
export const meta = {
  id: 'open-state-folder',
  order: 20,
  defaultEnabled: false,
  title: {
    zh: '托盘「打开 Pro Tools 数据目录」',
    en: 'Tray shortcut to the data folder',
  },
  description: {
    zh: '在托盘菜单里加入一个入口，用文件管理器打开存放 pro-tools 状态文件与桌面插件的目录。',
    en: 'Adds a tray row that opens the folder holding the Pro Tools state file and desktop plugin in the file manager.',
  },
};
