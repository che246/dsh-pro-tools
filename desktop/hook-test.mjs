#!/usr/bin/env node
/**
 * Exercise `desktop/tray-hook.js` (the Electron-side host) against stub Electron
 * objects and the real `desktop/plugin.cjs`.
 *
 * The host is injected into the desktop shell's main process, so this harness is
 * the only way to test it without restarting the application: it deploys the
 * plugin into a temporary Pro Tools directory, publishes a state file, and
 * inspects the menu the host hands to `Tray.setContextMenu`.
 *
 * @module dsh-pro-tools/desktop/hook-test
 */

import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hookPath = join(here, 'tray-hook.js');
const pluginSource = join(here, 'plugin.cjs');
const home = mkdtempSync(join(process.env.TEMP ?? process.env.TMP ?? homedir(), 'pro-tools-host-'));
process.env.DSH_HOME = home;

const dataDir = join(home, 'pro-tools');
const stateFile = join(dataDir, 'state.json');
const pluginFile = join(dataDir, 'desktop', 'plugin.cjs');
mkdirSync(join(dataDir, 'desktop'), { recursive: true });
copyFileSync(pluginSource, pluginFile);

const calls = [];
const app = { relaunch: () => calls.push('relaunch'), quit: () => calls.push('quit'), once: () => {} };
const shell = { openPath: (path) => calls.push(`openPath:${path}`), openExternal: (url) => calls.push(`openUrl:${url}`) };
const Menu = { buildFromTemplate: (items) => ({ items }) };
const messages = { openApplication: '打开 DeepSeek Harness', quitApplication: '退出 DeepSeek Harness' };
let language = 'zh';
const currentDesktopLocale = () => ({ id: language === 'zh' ? 'zh-CN' : 'en', messages });
const focusPrimaryWindow = () => calls.push('focus');
const quitWithoutConfirmation = () => calls.push('quitNow');
let tick;
const fakeSetInterval = (fn) => {
  tick = fn;
  return { unref() {} };
};

const source = readFileSync(hookPath, 'utf8').replace(/import\.meta\.url/g, 'importMetaUrl');
const factory = new Function(
  'createRequire', 'importMetaUrl', 'join', 'readFileSync', 'lstatSync', 'homedir',
  'Menu', 'app', 'shell', 'dialog', 'Notification', 'BrowserWindow', 'setInterval',
  'currentDesktopLocale', 'focusPrimaryWindow', 'quitWithoutConfirmation', 'tray', 'console',
  `${source}\nreturn dshProToolsDesktop;`,
);
const host = factory(
  createRequire, pathToFileURL(join(here, 'tray-hook.js')).href, join, readFileSync, lstatSync, homedir, Menu, app, shell, {}, function Notification() {}, function BrowserWindow() {}, fakeSetInterval,
  currentDesktopLocale, focusPrimaryWindow, quitWithoutConfirmation, undefined, console,
);

const menuTray = {
  current: undefined,
  tray: { setContextMenu: (menu) => { menuTray.current = menu; } },
  relabel() {
    Menu.buildFromTemplate([
      { label: '打开 DeepSeek Harness' },
      { type: 'separator' },
      { label: '退出 DeepSeek Harness' },
    ]);
  },
};

const labels = () => (menuTray.current?.items ?? []).map((item) => (item.type === 'separator' ? '---' : item.label));
const failures = [];
const assert = (value, message) => {
  if (!value) failures.push(message);
};
const writeState = (features) => writeFileSync(stateFile, JSON.stringify({ version: 2, features }, null, 2));
const touchPlugin = () => utimesSync(pluginFile, new Date(), new Date());

writeState({ 'restart-tray': true, 'open-state-folder': false });

host.attach(menuTray);
assert(host.stateFile === stateFile, `host resolved the wrong state file: ${host.stateFile}`);
assert(host.pluginFile === pluginFile, `host resolved the wrong plugin file: ${host.pluginFile}`);
assert(labels().includes('重启 DeepSeek Harness'), `plugin row missing after attach: ${JSON.stringify(labels())}`);
assert(!labels().includes('打开 Pro Tools 数据目录'), 'disabled switch leaked a row');
assert(labels().indexOf('重启 DeepSeek Harness') < labels().indexOf('---'), 'plugin rows must sit before the final separator');
assert(labels().includes('退出 DeepSeek Harness'), 'stock quit row was dropped');

menuTray.current.items.find((item) => item.label === '重启 DeepSeek Harness').click();
assert(calls.includes('relaunch') && calls.includes('quitNow'), 'restart row did not relaunch through the no-confirm quit');

// A settings toggle republishes the state; the poll must pick it up without a restart.
writeState({ 'restart-tray': true, 'open-state-folder': true });
tick();
assert(labels().includes('打开 Pro Tools 数据目录'), 'enabled switch did not add its row');

menuTray.current.items.find((item) => item.label === '打开 Pro Tools 数据目录').click();
assert(calls.includes(`openPath:${dataDir}`), `folder row opened the wrong path: ${JSON.stringify(calls)}`);

// Locale change re-runs the wrapper and must relabel through the plugin.
language = 'en';
menuTray.relabel();
assert(labels().includes('Restart DeepSeek Harness'), `English label missing: ${JSON.stringify(labels())}`);

// Replacing the plugin file must be observed by the poll (mtime in the poll signature).
touchPlugin();
tick();
assert(labels().includes('Restart DeepSeek Harness'), 'plugin reload dropped the rows');

// Disabling every switch leaves the stock menu.
writeState({ 'restart-tray': false, 'open-state-folder': false });
tick();
assert(!labels().some((label) => label.includes('Restart')), 'disabled state left a plugin row');
assert(labels().includes('退出 DeepSeek Harness'), 'stock rows were not restored');

// Removing the state file is the "bundle disabled" state.
rmSync(stateFile, { force: true });
tick();
assert(labels().includes('退出 DeepSeek Harness'), 'menu broke when the state file disappeared');
assert(host.readRows().length === 0, 'rows survived an absent state file');

// Garbage state must not throw and must not produce rows.
writeFileSync(stateFile, '{ not json', 'utf8');
tick();
assert(labels().length > 0, 'garbage state broke the menu');

rmSync(home, { recursive: true, force: true });

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exitCode = 1;
} else {
  console.log('desktop host: all assertions passed');
}
